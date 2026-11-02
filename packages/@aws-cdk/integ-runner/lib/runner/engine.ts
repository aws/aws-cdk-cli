import type { CdkTestAppOptions } from './cdk-test-app';
import { ToolkitLibRunnerEngine } from '../engines/toolkit-lib';

/**
 * Creates the engine for running integration tests.
 *
 * Only the toolkit-lib engine is supported.
 */
export function makeEngine(options: EngineOptions): ToolkitLibRunnerEngine {
  return new ToolkitLibRunnerEngine({
    workingDirectory: options.test.workingDirectory,
    showOutput: options.showOutput,
    env: options.env,
    region: options.region,
    profile: options.profile,
    proxy: options.proxy,
    caBundlePath: options.caBundlePath,
  });
}

export type EngineOptions = Pick<CdkTestAppOptions, 'test' | 'showOutput' | 'env' | 'region' | 'profile' | 'proxy' | 'caBundlePath'>;
