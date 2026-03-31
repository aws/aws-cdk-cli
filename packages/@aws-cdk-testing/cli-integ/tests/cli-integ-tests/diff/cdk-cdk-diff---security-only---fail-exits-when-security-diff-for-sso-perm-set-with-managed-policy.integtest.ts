import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --security-only --fail exits when security diff for sso-perm-set-with-managed-policy',
  withDefaultFixture(async (fixture) => {
    await expect(
      fixture.cdk(['diff', '--security-only', '--fail', fixture.fullStackName('sso-perm-set-with-managed-policy')]),
    ).rejects.toThrow('exited with error');
  }),
);

