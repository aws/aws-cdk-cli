import type * as cxapi from '@aws-cdk/cx-api';
import type { StackSummary } from '@aws-sdk/client-cloudformation';
import type { IAws } from 'cdk-assets';
import { DefaultAwsClient } from 'cdk-assets';
import { replaceAwsPlaceholders } from 'cdk-assets/lib/private/placeholders';
import { Mode } from '../plugin';
import type { CloudFormationStack } from './cloudformation';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { deserializeStructure, formatErrorMessage } from '../../util';
import type { ICloudFormationClient } from '../aws-auth/sdk';
import type { SdkProvider } from '../aws-auth/sdk-provider';
import { EnvironmentResourcesRegistry } from '../environment';
import type { IoHelper } from '../io/private';
import { IO } from '../io/private';

/**
 * A container for stacks in all environments.
 */
export class StackContainer {
  private readonly aws: IAws;
  private readonly stacksByEnvironment: Map<string, CloudFormationStack[]> = new Map();
  private readonly environmentResourcesRegistry: EnvironmentResourcesRegistry;

  constructor(
    private readonly sdkProvider: SdkProvider,
    private readonly ioHelper: IoHelper,
    private readonly localStacks: (CloudFormationStack & { assumeRoleArn?: string })[]) {
    this.aws = new DefaultAwsClient();
    this.environmentResourcesRegistry = new EnvironmentResourcesRegistry();
  }

  public async getDeployedStacks(environment: cxapi.Environment): Promise<CloudFormationStack[]> {
    const envKey = envToString(environment);
    if (this.stacksByEnvironment.has(envKey)) {
      return this.stacksByEnvironment.get(envKey)!;
    }

    const cfn = (await this.sdkProvider.forEnvironment(environment, Mode.ForReading)).sdk.cloudFormation();

    const summaries = await cfn.paginatedListStacks({
      StackStatusFilter: [
        'CREATE_COMPLETE',
        'UPDATE_COMPLETE',
        'UPDATE_ROLLBACK_COMPLETE',
        'IMPORT_COMPLETE',
        'ROLLBACK_COMPLETE',
      ],
    });

    const normalize = async (summary: StackSummary) => {
      const templateCommandOutput = await cfn.getTemplate({ StackName: summary.StackName! });
      const template = deserializeStructure(templateCommandOutput.TemplateBody ?? '{}');
      return {
        environment,
        stackName: summary.StackName!,
        template,
      };
    };

    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    const result = await Promise.all(summaries.map(normalize));
    this.stacksByEnvironment.set(envKey, result);
    return result;
  }

  /**
   * Executes a callback for each known environment. The callback receives the
   * CloudFormation client and the stacks that are deployed in that
   * environment. The CloudFormation client is already configured to assume the
   * role that is needed to deploy the stacks in that environment. In most cases,
   * this will be the deployment role of a modern bootstrap stack. If this role
   * cannot be found, it will proceed without assuming a role, falling back to
   * the default credentials.
   *
   * The callback can throw an error. If it does, the error will be logged, and
   * the next environment will be processed. This function returns true if, and
   * only if, all environments were processed successfully.
   *
   */
  public async forEachEnvironment(
    cb: (client: ICloudFormationClient, stacks: CloudFormationStack[]) => Promise<void>,
  ): Promise<boolean> {
    let success = true;
    const environments = Array.from(this.stacksByEnvironment.keys()).map(stringToEnv);
    for (const env of environments) {
      const sdk = (await this.sdkProvider.forEnvironment(env, Mode.ForWriting, {
        assumeRoleArn: await this.assumeRoleArn(env),
      })).sdk;

      const envResources = this.environmentResourcesRegistry.for(env, sdk, this.ioHelper);
      let bootstrapVersion: number | undefined = undefined;
      try {
        // Try to get the bootstrap version
        bootstrapVersion = (await envResources.lookupToolkit()).version;
      } catch (e) {
        // But if we can't, keep going. Maybe we can still succeed.
      }
      if (bootstrapVersion != null && bootstrapVersion < 28) {
        const resolvedEnv = await this.sdkProvider.resolveEnvironment(env);
        throw new ToolkitError(
          `The CDK toolkit stack in environment aws://${resolvedEnv.account}/${resolvedEnv.region} doesn't support refactoring. Please run 'cdk bootstrap' to update it.`,
        );
      }

      const cfn = sdk.cloudFormation();
      const stacks = await this.getDeployedStacks(env);
      try {
        await cb(cfn, stacks);
      } catch (e: any) {
        success = false;
        const resolvedEnv = await this.sdkProvider.resolveEnvironment(env);
        await this.ioHelper.notify(IO.CDK_TOOLKIT_E8900.msg(`Refactor execution failed for environment aws://${resolvedEnv.account}/${resolvedEnv.region}. ${formatErrorMessage(e)}`, { error: e }));
      }
    }
    return success;
  }

  private async assumeRoleArn(env: cxapi.Environment): Promise<string | undefined> {
    // To execute a refactor, we need the deployment role ARN for the given
    // environment. Most toolkit commands get the information about which roles to
    // assume from the cloud assembly (and ultimately from the CDK framework). Refactor
    // is different because it is not the application/framework that dictates what the
    // toolkit should do, but it is the toolkit itself that has to figure it out.
    //
    // Nevertheless, the cloud assembly is the most reliable source for this kind of
    // information. For the deployment role ARN, in particular, what we do here
    // is look at all the stacks for a given environment in the cloud assembly and
    // extract the deployment role ARN that is common to all of them. If no role is
    // found, we go ahead without assuming a role. If there is more than one role,
    // we consider that an invariant was violated, and throw an error.

    const roleArns = new Set(
      this.localStacks
        .filter((s) => s.environment.account === env.account && s.environment.region === env.region)
        .map((s) => s.assumeRoleArn),
    );

    if (roleArns.size === 0) {
      throw new ToolkitError(
        `No deployment role ARN found for environment aws://${env.account}/${env.region}. Cannot proceed.`,
      );
    }

    if (roleArns.size !== 1) {
      // Unlikely to happen. But if it does, we can't proceed
      throw new ToolkitError(
        `Multiple stacks in environment aws://${env.account}/${env.region} have different deployment role ARNs. Cannot proceed.`,
      );
    }

    const arn = Array.from(roleArns)[0];
    if (arn != null) {
      return (await replaceAwsPlaceholders({ region: undefined, assumeRoleArn: arn }, this.aws)).assumeRoleArn;
    }
    // If we couldn't find a role ARN, we can proceed without assuming a role.
    // Maybe the default credentials have permissions to do what we need.
    return undefined;
  }
}

function envToString(env: cxapi.Environment): string {
  return `${env.name}#${env.account}#${env.region}`;
}

function stringToEnv(envString: string): cxapi.Environment {
  const [name, account, region] = envString.split('#');
  return { name, account, region };
}
