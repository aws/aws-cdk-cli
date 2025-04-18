import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'Termination protection',
  withDefaultFixture(async (fixture) => {
    const stackName = 'termination-protection';
    await fixture.cdkDeploy(stackName);

    // Try a destroy that should fail
    await expect(fixture.cdkDestroy(stackName)).rejects.toThrow('exited with error');

    // Can update termination protection even though the change set doesn't contain changes
    await fixture.cdkDeploy(stackName, { modEnv: { TERMINATION_PROTECTION: 'FALSE' } });
    await fixture.cdkDestroy(stackName);
  }),
);

