import type { CdkIntegHelperOptions } from './cdk-integ-helper';
import { ToolkitLibRunnerEngine } from '../engines/toolkit-lib';

/**
 * Creates the engine for running integration tests.
 *
 * Only the toolkit-lib engine is supported.
 */
export function makeEngine(options: CdkIntegHelperOptions): ToolkitLibRunnerEngine {
  return new ToolkitLibRunnerEngine({
    workingDirectory: options.test.directory,
    showOutput: options.showOutput,
    env: options.env,
    region: options.region,
    profile: options.profile,
    proxy: options.proxy,
    caBundlePath: options.caBundlePath,
  });
}
