import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'publish-assets then deploy detects already uploaded assets',
  withDefaultFixture(async (fixture) => {
    const stackName = 'lambda';
    const fullStackName = fixture.fullStackName(stackName);

    // First, publish assets
    const publishOutput = await fixture.cdk(['publish-assets', fullStackName, '--unstable=publish-assets']);
    expect(publishOutput).toMatch('Assets published successfully');

    // Then deploy the same stack; it should detect the already published assets and skip re-publishing
    const deployOutput = await fixture.cdkDeploy(stackName, { options: ['-v'], captureStderr: true });
    expect(deployOutput).toMatch(/0 still need to be published/);

    // Clean up
    await fixture.cdkDestroy(stackName);
  }),
);
