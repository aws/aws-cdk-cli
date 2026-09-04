import type { CdkCliOptions } from '../../../lib';
import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'ci=true output to stdout',

  // We need to use an app that we are sure is not going to lead to
  // CloudFormation-Validate warnings, because those will interfere
  // with the stdout/stderr checks.
  withSpecificFixture('simple-app', async (fixture) => {
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

        // Suppress Node.js process warnings (e.g. fs-extra compatibility warnings)
        NODE_NO_WARNINGS: '1',
      },
      options: ['--no-notices'],
    };

    const stackName = 'simple-1';

    const deployOutput = await fixture.cdkDeploy(stackName, execOptions);
    const diffOutput = await fixture.cdk(['diff', '--no-notices', fixture.fullStackName(stackName)], execOptions);
    const destroyOutput = await fixture.cdkDestroy(stackName, execOptions);
    expect(deployOutput).toEqual('');
    expect(destroyOutput).toEqual('');
    expect(diffOutput).toEqual('');
  }),
);

