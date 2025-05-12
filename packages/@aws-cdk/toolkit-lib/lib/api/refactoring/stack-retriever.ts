import type * as cxapi from '@aws-cdk/cx-api';
import type { StackSummary } from '@aws-sdk/client-cloudformation';
import { Mode } from '../plugin';
import type { CloudFormationStack } from './cloudformation';
import { deserializeStructure } from '../../util';
import type { ICloudFormationClient } from '../aws-auth/sdk';
import type { SdkProvider } from '../aws-auth/sdk-provider';

/**
 * Stateful retriever of stacks deployed in an environment.
 */
// TODO Maybe this class should have another name, along the lines of
//  "StackContainer".
export class StackRetriever {
  private readonly stacksByEnvironment: Map<string, CloudFormationStack[]> = new Map();

  constructor(private readonly sdkProvider: SdkProvider) {
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

  public async forEachEnvironment(cb: (client: ICloudFormationClient, stacks: CloudFormationStack[]) => Promise<void>): Promise<void> {
    const environments = Array.from(this.stacksByEnvironment.keys()).map(stringToEnv);
    for (const env of environments) {
      const cfn = (await this.sdkProvider.forEnvironment(env, Mode.ForWriting)).sdk.cloudFormation();
      const stacks = await this.getDeployedStacks(env);
      await cb(cfn, stacks);
    }
  }
}

function envToString(env: cxapi.Environment): string {
  return `${env.name}:${env.account}:${env.region}`;
}

function stringToEnv(envString: string): cxapi.Environment {
  const [name, account, region] = envString.split(':');
  return { name, account, region };
}
