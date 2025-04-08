import type * as cxapi from '@aws-cdk/cx-api';
import type { IReadableCloudAssembly } from '../types';

/**
 * An implementation of `IReadableCloudAssembly` that does nothing except hold on to the CloudAssembly object
 *
 * It does not own a lock, and it does not clean the underlying directory.
 */
export class BorrowedAssembly implements IReadableCloudAssembly {
  constructor(public readonly cloudAssembly: cxapi.CloudAssembly) {
  }

  public async _unlock(): Promise<void> {
  }

  public async dispose(): Promise<void> {
  }

  public async [Symbol.asyncDispose](): Promise<void> {
  }
}

