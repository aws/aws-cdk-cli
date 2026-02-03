import type { IntegRunnerOptions } from './runner-base';
import { ToolkitLibRunnerEngine } from '../engines/toolkit-lib';

/**
 * Engine options for the integ runner
 *
 * Note: The 'cli-wrapper' engine has been removed. Only 'toolkit-lib' is supported.
 */
export interface EngineOptions {
  /**
   * The CDK Toolkit engine to be used by the runner.
   *
   * @default "toolkit-lib"
   */
  readonly engine?: 'toolkit-lib';
}

/**
 * Creates the engine for running integration tests.
 *
 * Only the toolkit-lib engine is supported.
 */
export function makeEngine(options: IntegRunnerOptions): ToolkitLibRunnerEngine {
  return new ToolkitLibRunnerEngine({
    workingDirectory: options.test.directory,
    showOutput: options.showOutput,
    env: options.env,
    region: options.region,
    profile: options.profile,
  });
}
