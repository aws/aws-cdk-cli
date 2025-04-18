import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'ci output to stderr',
  withDefaultFixture(async (fixture) => {
    const deployOutput = await fixture.cdkDeploy('test-2', { captureStderr: true, onlyStderr: true });
    const diffOutput = await fixture.cdk(['diff', fixture.fullStackName('test-2')], {
      captureStderr: true,
      onlyStderr: true,
    });
    const destroyOutput = await fixture.cdkDestroy('test-2', { captureStderr: true, onlyStderr: true });
    expect(deployOutput).not.toEqual('');
    expect(destroyOutput).not.toEqual('');
    expect(diffOutput).not.toEqual('');
  }),
);

