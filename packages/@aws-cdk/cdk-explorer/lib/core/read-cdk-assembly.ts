import { ToolkitError, type IReadableCloudAssembly, type Toolkit } from '@aws-cdk/toolkit-lib';

/**
 * Retry the given producer as long as the error is a lock
 */
export async function retryOnLock(abort: AbortSignal, fn: () => Promise<IReadableCloudAssembly>) {
  let delayMs = 500;
  const deadline = AbortSignal.any([abort, AbortSignal.timeout(60 * 60 * 1000)]);
  while (true) {
    deadline.throwIfAborted();
    try {
      return await fn();
    } catch (error: any) {
      if (!ToolkitError.isLockError(error)) {
        throw error;
      }
      await sleep(Math.floor(Math.random() * delayMs));
      delayMs = Math.min(delayMs * 2, 10_000);
    }
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function readAssemblyDirectory(toolkit: Toolkit, abort: AbortSignal, assemblyDir: string) {
  const asmSource = await toolkit.fromAssemblyDirectory(assemblyDir);
  // NOTE: Purposely using asmSource.produce() here: toolkit.synth() would throw on validation failures and we don't necessarily want that.
  return retryOnLock(abort, () => asmSource.produce({ abort: abort }));
}
