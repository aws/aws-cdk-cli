import type { CdkCliOptions } from '../../../lib';
import { integTest, withDefaultFixture, withRetry } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'ci=true output to stdout',
  withRetry(withDefaultFixture(async (fixture) => {
    const execOptions: CdkCliOptions = {
      captureStderr: true,
      onlyStderr: true,
      modEnv: {
        CI: 'true',

        // Disable all Node.js version warnings
        JSII_SILENCE_WARNING_KNOWN_BROKEN_NODE_VERSION: 'true',
        JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION: 'true',
        JSII_SILENCE_WARNING_DEPRECATED_NODE_VERSION: 'true',

        // Make sure we don't warn on use of deprecated APIs (that cannot be redirected)
        JSII_DEPRECATED: 'quiet',
      },
      options: ['--no-notices'],
    };

    const deployOutput = await fixture.cdkDeploy('test-2', execOptions);
    const diffOutput = await fixture.cdk(['diff', '--no-notices', fixture.fullStackName('test-2')], execOptions);
    const destroyOutput = await fixture.cdkDestroy('test-2', execOptions);
    expect(deployOutput).toEqual('');
    expect(destroyOutput).toEqual('');
    expect(diffOutput).toEqual('');
  })),
);

