import { ToolkitError, type FromCdkAppOptions, type ICloudAssemblySource, type IReadableCloudAssembly, type Toolkit } from '@aws-cdk/toolkit-lib';
import { readCdkConfig } from './cdk-config';

/**
 * Returns an assembly source from a CDK app directory
 *
 * This could/should have been built into the toolkit library itself, but isn't
 * currently.
 *
 * Returns `undefined` if we can't determine a valid CDK app in the directory.
 */
export async function fromCdkAppDirectory(
  toolkit: Toolkit,
  appDirectory: string,
  props: FromCdkAppOptions = {},
): Promise<ICloudAssemblySource | undefined> {
  const config = await readCdkConfig(appDirectory);

  if (!config?.app) {
    return undefined;
  }

  return toolkit.fromCdkApp(config.app, {
    ...props,
    outdir: config.output,
    workingDirectory: appDirectory,
    lookups: false,
    // Make jsii forward host-language (Python/Java) source frames; TS resolves via source maps.
    env: {
      ...props.env,
      JSII_HOST_STACK_TRACES: '1',
    },
  });
}

/**
 * Retry the given producer as long as the error is a lock
 */
export async function retryOnLock(abort: AbortSignal, fn: () => Promise<IReadableCloudAssembly>) {
  let delayMs = 500;
  const deadline = AbortSignal.any([abort, AbortSignal.timeout(60 * 60 * 1000)]);
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      if (!ToolkitError.isLockError(error)) {
        throw error;
      }
      if (deadline.aborted) {
        throw new Error('Gave up waiting for lock');
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
