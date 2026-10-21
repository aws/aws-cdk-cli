import { CloudFormationStack } from './stack-helpers';
import { pLimit } from '../../util/concurrency';
import type { ICloudControlClient, ICloudFormationClient } from '../aws-auth/private';

/**
 * Lookups of deployed resources and stacks, shared by all the evaluators of one evaluation run
 *
 * Each resource and stack is read once, and at most `concurrency` lookups run at the same time across all
 * evaluators, however many stacks and nested stacks are evaluated in parallel. A failed lookup is not remembered.
 */
export class SharedLookups {
  private readonly limit: ReturnType<typeof pLimit>;
  private readonly resources = new Map<string, Promise<{ [property: string]: any }>>();
  private readonly stackOutputs = new Map<string, Promise<{ [output: string]: string }>>();

  public constructor(concurrency: number = 10) {
    this.limit = pLimit(concurrency);
  }

  /**
   * The properties of a resource, read through Cloud Control
   *
   * @param scope - account and region of the client, so the same identifier in two environments isn't shared
   */
  public resourceProperties(cloudControl: ICloudControlClient, scope: string, typeName: string, identifier: string) {
    return this.once(this.resources, JSON.stringify([scope, typeName, identifier]), async () => {
      const response = await cloudControl.getResource({ TypeName: typeName, Identifier: identifier });
      return JSON.parse(response.ResourceDescription?.Properties ?? '{}');
    });
  }

  /**
   * The outputs of a deployed stack, as CloudFormation reports them
   */
  public deployedStackOutputs(cfn: ICloudFormationClient, scope: string, stackName: string) {
    return this.once(this.stackOutputs, JSON.stringify([scope, stackName]), async () => {
      return (await CloudFormationStack.lookup(cfn, stackName)).outputs;
    });
  }

  private once<T>(cache: Map<string, Promise<T>>, key: string, lookup: () => Promise<T>): Promise<T> {
    let result = cache.get(key);
    if (!result) {
      result = this.limit(lookup).catch((e) => {
        cache.delete(key);
        throw e;
      });
      cache.set(key, result);
    }
    return result;
  }
}
