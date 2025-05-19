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
import type { StackAssembly } from '../cloud-assembly/private';

/**
 * Stateful retriever of stacks deployed in an environment.
 */
// TODO Maybe this class should have another name, along the lines of
//  "StackContainer".
export class StackRetriever {
  private readonly aws: IAws;
  private readonly stacksByEnvironment: Map<string, CloudFormationStack[]> = new Map();

  constructor(private readonly sdkProvider: SdkProvider, private readonly assembly: StackAssembly) {
    this.aws = new DefaultAwsClient();
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
      const cfn = (
        await this.sdkProvider.forEnvironment(env, Mode.ForWriting, {
          assumeRoleArn: await this.assumeRoleArn(env),
        })
      ).sdk.cloudFormation();
      const stacks = await this.getDeployedStacks(env);
      await cb(cfn, stacks);
    }
  }

  private async assumeRoleArn(env: cxapi.Environment): Promise<string | undefined> {
    const arn = this.deploymentRoleArnFor(env);
    if (arn != null) {
      return (await replaceAwsPlaceholders({ region: undefined, assumeRoleArn: arn }, this.aws)).assumeRoleArn;
    }
    return undefined;
  }

  private deploymentRoleArnFor(env: cxapi.Environment): string | undefined {
    const roleArns = new Set(
      this.assembly.cloudAssembly.stacks
        .filter((s) => s.environment.account === env.account && s.environment.region === env.region)
        .map((s) => s.assumeRoleArn),
    );

    // Validating that all stacks in the same environment have the same role ARN.
    // This should normally be the case, but in case it isn't, all bets are off.
    if (roleArns.size !== 1) {
      throw new ToolkitError(
        'Multiple stacks in the same environment have different deployment role ARNs. This is not supported.',
      );
    }

    return Array.from(roleArns)[0];
  }
}

function envToString(env: cxapi.Environment): string {
  return `${env.name}#${env.account}#${env.region}`;
}

function stringToEnv(envString: string): cxapi.Environment {
  const [name, account, region] = envString.split('#');
  return { name, account, region };
}
