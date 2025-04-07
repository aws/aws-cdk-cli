import type { CloudAssembly } from '@aws-cdk/cx-api';
import type { ICloudAssemblySource, MaybeLockedCloudAssembly } from '../types';

/**
 * A CloudAssemblySource that is caching its result once produced.
 *
 * Most Toolkit interactions should use a cached source.
 * Not caching is relevant when the source changes frequently
 * and it is to expensive to predict if the source has changed.
 */
export class CachedCloudAssemblySource implements ICloudAssemblySource {
  private source: ICloudAssemblySource;
  private cloudAssembly: CloudAssembly | undefined;

  public constructor(source: ICloudAssemblySource) {
    this.source = source;
  }

  public async produce(): Promise<MaybeLockedCloudAssembly> {
    if (!this.cloudAssembly) {
      this.cloudAssembly = await this.source.produce();
    }
    return this.cloudAssembly;
  }
}
