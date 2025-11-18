import type { ICdk } from '@aws-cdk/cdk-cli-wrapper';
import { CdkCliWrapper } from '@aws-cdk/cdk-cli-wrapper';
import type { IntegRunnerOptions } from './runner-base';
import { ToolkitLibRunnerEngine } from '../engines/toolkit-lib';

export interface EngineOptions {
  /**
   * The CDK Toolkit engine to be used by the runner.
   *
   * @default "cli-wrapper"
   */
  readonly engine?: 'cli-wrapper' | 'toolkit-lib';
}

export function makeEngine(options: IntegRunnerOptions): ICdk {
  switch (options.engine) {
    case 'toolkit-lib':
      return new ToolkitLibRunnerEngine({
        workingDirectory: options.test.directory,
        showOutput: options.showOutput,
        env: options.env,
        region: options.region,
      });
    case 'cli-wrapper':
    default:
      return new CdkCliWrapper({
        directory: options.test.directory,
        showOutput: options.showOutput,
        env: {
          ...options.env,
          // The CDK CLI will interpret this and use it usefully
          AWS_REGION: options.region,
        },
      });
  }
}

