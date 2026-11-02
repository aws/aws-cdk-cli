import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'publish-assets is idempotent and --force re-uploads',
  withDefaultFixture(async (fixture) => {
    const stackName = 'lambda';
    const fullStackName = fixture.fullStackName(stackName);

    // First publish
    const firstOutput = await fixture.cdk(['publish-assets', fullStackName, '--unstable=publish-assets']);
    expect(firstOutput).toMatch('Assets published successfully');

    // Second publish without --force should detect nothing to do
    const secondOutput = await fixture.cdk(['publish-assets', fullStackName, '--unstable=publish-assets']);
    expect(secondOutput).toMatch('All assets are already published');

    // Third publish with --force should re-upload
    const forceOutput = await fixture.cdk(['publish-assets', fullStackName, '--unstable=publish-assets', '--force']);
    expect(forceOutput).toMatch('Assets published successfully');
  }),
);
