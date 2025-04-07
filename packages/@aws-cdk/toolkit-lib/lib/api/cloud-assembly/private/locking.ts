import type * as cxapi from '@aws-cdk/cx-api';
import type { IReadLock } from '@aws-cdk/tmp-toolkit-helpers';
import type { MaybeLockedCloudAssembly } from '../types';
import { LOCK_SYM } from '../types';

export function associateLock(x: cxapi.CloudAssembly, lock: IReadLock): MaybeLockedCloudAssembly {
  return Object.create(x, {
    [LOCK_SYM]: { value: lock },
  });
}
