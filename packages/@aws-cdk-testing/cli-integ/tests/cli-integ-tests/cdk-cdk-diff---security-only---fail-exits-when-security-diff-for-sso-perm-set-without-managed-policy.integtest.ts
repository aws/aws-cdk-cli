import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk diff --security-only --fail exits when security diff for sso-perm-set-without-managed-policy',
  withDefaultFixture(async (fixture) => {
    await expect(
      fixture.cdk(['diff', '--security-only', '--fail', fixture.fullStackName('sso-perm-set-without-managed-policy')]),
    ).rejects.toThrow('exited with error');
  }),
);

