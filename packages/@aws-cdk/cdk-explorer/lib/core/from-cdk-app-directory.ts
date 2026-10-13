import type { FromCdkAppOptions, ICloudAssemblySource, Toolkit } from '@aws-cdk/toolkit-lib';
import { readCdkConfig } from './cdk-config';

/**
 * Returns an assembly source from a CDK app directory
 *
 * This could/should have been built into the toolkit library itself, but isn't
 * currently.
 */
export async function fromCdkAppDirectory(toolkit: Toolkit, appDirectory: string, props: FromCdkAppOptions = {}): Promise<ICloudAssemblySource> {
  const config = await readCdkConfig(appDirectory);

  if (!config.app) {
    throw new Error(`${appDirectory}/cdk.json is missing or does not specify an app`);
  }

  return toolkit.fromCdkApp(config.app, {
    ...props,
    outdir: config.output,
    workingDirectory: appDirectory,
  });
}
