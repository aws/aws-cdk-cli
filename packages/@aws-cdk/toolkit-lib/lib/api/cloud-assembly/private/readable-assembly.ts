import { promises as fs } from 'node:fs';
import type * as cxapi from '@aws-cdk/cx-api';
import type { IReadLock } from '../../rwlock';
import type { IReadableCloudAssembly } from '../types';

export interface ReadableCloudAssemblyOptions {
  /**
   * Delete the Cloud Assembly directory when the object is disposed
   *
   * @default false
   */
  readonly deleteOnDispose?: boolean;
}

/**
 * The canonical implementation of `IReadableCloudAssembly`
 *
 * Holds a read lock that is unlocked on disposal, as well as optionally deletes the
 * cloud assembly directory.
 */
export class ReadableCloudAssembly implements IReadableCloudAssembly {
  constructor(
    public readonly cloudAssembly: cxapi.CloudAssembly,
    private readonly lock: IReadLock,
    private readonly options?: ReadableCloudAssemblyOptions,
  ) {
  }

  public async _unlock(): Promise<void> {
    return this.lock.release();
  }

  public async dispose(): Promise<void> {
    await this.lock.release();
    if (this.options?.deleteOnDispose) {
      await fs.rm(this.cloudAssembly.directory, { recursive: true, force: true });
    }
  }

  public [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }
}
