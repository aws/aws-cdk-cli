import type * as cxapi from '@aws-cdk/cx-api';
import type { IReadLock } from '../../../../tmp-toolkit-helpers/src/api';

export interface ICloudAssemblySource {
  /**
   * Produce a CloudAssembly from the current source
   */
  produce(): Promise<MaybeLockedCloudAssembly>;
}

export const LOCK_SYM = Symbol();

/**
 * A cloud assembly that can have a read lock associated with it
 */
export type MaybeLockedCloudAssembly = cxapi.CloudAssembly & { [LOCK_SYM]?: IReadLock };
