import type * as cxapi from '@aws-cdk/cx-api';
import type { StackSummary } from '@aws-sdk/client-cloudformation';
import type { IAws } from 'cdk-assets';
import { DefaultAwsClient } from 'cdk-assets';
import { replaceAwsPlaceholders } from 'cdk-assets/lib/private/placeholders';
import { Mode } from '../plugin';
import type { CloudFormationStack } from './cloudformation';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { deserializeStructure } from '../../util';
import type { ICloudFormationClient } from '../aws-auth/sdk';
import type { SdkProvider } from '../aws-auth/sdk-provider';
import { EnvironmentResourcesRegistry } from '../environment';
import { IO, IoHelper } from '../io/private';

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

  public async forEachEnvironment(
    cb: (client: ICloudFormationClient, stacks: CloudFormationStack[]) => Promise<void>,
  ): Promise<void> {
    const environments = Array.from(this.stacksByEnvironment.keys()).map(stringToEnv);
    for (const env of environments) {
      const sdk = (await this.sdkProvider.forEnvironment(env, Mode.ForWriting, {
        assumeRoleArn: await this.assumeRoleArn(env),
      })).sdk;

      const envResources = this.environmentResourcesRegistry.for(env, sdk, this.ioHelper);
      if ((await envResources.lookupToolkit()).version < 28) {
        throw new ToolkitError(
          `The CDK toolkit stack in environment aws://${env.account}/${env.region} doesn't support refactoring. Please run 'cdk bootstrap' to update it.`,
        );
      }

      const cfn = sdk.cloudFormation();
      const stacks = await this.getDeployedStacks(env);
      try {
        await cb(cfn, stacks);
      } catch (e: any) {
        await this.ioHelper.notify(IO.CDK_TOOLKIT_E8900.msg(`Refactor execution failed for environment aws://${env.account}/${env.region}`, { error: e }));
      }
    }
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

    if (roleArns.size !== 1) {
      throw new ToolkitError(
        'Multiple stacks in the same environment have different deployment role ARNs. This is not supported.',
      );
    }

    const arn = Array.from(roleArns)[0];
    if (arn != null) {
      return (await replaceAwsPlaceholders({ region: undefined, assumeRoleArn: arn }, this.aws)).assumeRoleArn;
    }
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
