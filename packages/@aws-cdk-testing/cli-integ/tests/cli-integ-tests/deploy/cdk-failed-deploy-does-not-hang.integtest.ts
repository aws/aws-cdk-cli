import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'failed deploy does not hang',
  withDefaultFixture(async (fixture) => {
    // this will hang if we introduce https://github.com/aws/aws-cdk/issues/6403 again.
    await expect(fixture.cdkDeploy('failed')).rejects.toThrow('exited with error');
  }),
);

