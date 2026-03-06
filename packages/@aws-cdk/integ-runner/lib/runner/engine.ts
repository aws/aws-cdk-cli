import type { IntegRunnerOptions } from './runner-base';
import { ToolkitLibRunnerEngine } from '../engines/toolkit-lib';

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
