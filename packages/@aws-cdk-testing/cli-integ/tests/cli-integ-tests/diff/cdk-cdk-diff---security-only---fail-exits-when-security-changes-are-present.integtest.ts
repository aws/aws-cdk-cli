import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --security-only --fail exits when security changes are present',
  withDefaultFixture(async (fixture) => {
    const stackName = 'iam-test';
    await expect(fixture.cdk(['diff', '--security-only', '--fail', fixture.fullStackName(stackName)])).rejects.toThrow(
      'exited with error',
    );
  }),
);

