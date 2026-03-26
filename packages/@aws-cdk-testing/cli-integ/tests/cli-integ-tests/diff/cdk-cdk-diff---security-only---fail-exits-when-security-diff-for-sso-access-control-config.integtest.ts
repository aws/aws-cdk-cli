import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --security-only --fail exits when security diff for sso access control config',
  withDefaultFixture(async (fixture) => {
    await expect(
      fixture.cdk(['diff', '--security-only', '--fail', fixture.fullStackName('sso-access-control')]),
    ).rejects.toThrow('exited with error');
  }),
);

