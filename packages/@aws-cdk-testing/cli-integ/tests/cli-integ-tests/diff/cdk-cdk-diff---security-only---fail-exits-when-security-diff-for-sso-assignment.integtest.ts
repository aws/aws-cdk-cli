import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --security-only --fail exits when security diff for sso-assignment',
  withDefaultFixture(async (fixture) => {
    await expect(
      fixture.cdk(['diff', '--security-only', '--fail', fixture.fullStackName('sso-assignment')]),
    ).rejects.toThrow('exited with error');
  }),
);

