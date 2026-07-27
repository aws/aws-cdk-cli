import type { Toolkit } from '@aws-cdk/toolkit-lib';

/**
 * A held read lock on the cloud assembly directory; `release()` unlocks it.
 * Wraps the Toolkit's `fromAssemblyDirectory().produce()` readable.
 */
export interface AssemblyLock {
  release(): Promise<void>;
}

/** Acquire a read lock on the assembly dir; throws a `LockError` on writer contention. */
export type AcquireAssemblyLock = (assemblyDir: string) => Promise<AssemblyLock>;

/**
 * Builds an assembly read-lock acquirer from a Toolkit. The read lock is the
 * Toolkit's own `fromAssemblyDirectory().produce()` lease, so callers never
 * touch `RWLock` directly; `release()` disposes the lease.
 */
export function toolkitAssemblyLock(toolkit: Toolkit): AcquireAssemblyLock {
  return async (assemblyDir) => {
    const cx = await toolkit.fromAssemblyDirectory(assemblyDir, { failOnMissingContext: false });
    const readable = await cx.produce();
    return { release: () => readable.dispose() };
  };
}
