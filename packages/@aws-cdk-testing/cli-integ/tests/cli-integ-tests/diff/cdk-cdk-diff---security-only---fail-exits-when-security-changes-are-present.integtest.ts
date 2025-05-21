import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk diff --security-only --fail exits when security changes are present',
  withDefaultFixture(async (fixture) => {
    const stackName = 'iam-test';
    await expect(fixture.cdk(['diff', '--security-only', '--fail', fixture.fullStackName(stackName)])).rejects.toThrow(
      'exited with error',
    );
  }),
);

