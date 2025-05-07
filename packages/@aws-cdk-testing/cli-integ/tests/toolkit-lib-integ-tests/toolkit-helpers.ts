/* eslint-disable import/no-extraneous-dependencies */
import { promises as fs } from 'fs';
import * as path from 'path';
import * as toolkit from '@aws-cdk/toolkit-lib';
import type { AwsContext, TestFixture } from '../../lib';

/**
 * Create a toolkit that's initialized from the given fixture
 *
 * Will use specific (Atmosphere-provided) credentials if they're available, and
 * fall back to SDK-compatible credentials otherwise.
 */
export function toolkitFromFixture(fixture: AwsContext, options?: Omit<toolkit.ToolkitOptions, 'sdkConfig'>) {
  return new toolkit.Toolkit({
    ...options,
    sdkConfig: {
      baseCredentials: fixture.aws.identity
        ? toolkit.BaseCredentials.custom({
          region: fixture.aws.region,
          provider: () => Promise.resolve(fixture.aws.identity!),
        })
        : undefined,
    },
  });
}

/**
 * Helper function to convert a CDK app directory into an Assembly Source
 *
 * This will eventually become part of the toolkit itself, but isn't yet.
 */
export async function assemblyFromCdkAppDir(tk: toolkit.Toolkit, fixture: TestFixture) {
  const cdkAppDir = fixture.integTestDir;
  const cdkJson = await JSON.parse(await fs.readFile(path.join(cdkAppDir, 'cdk.json'), 'utf-8'));
  const app = cdkJson.app;

  return tk.fromCdkApp(app, {
    workingDirectory: cdkAppDir,
    env: {
      STACK_NAME_PREFIX: fixture.stackNamePrefix,
      PACKAGE_LAYOUT_VERSION: '2',
    },
  });
}
