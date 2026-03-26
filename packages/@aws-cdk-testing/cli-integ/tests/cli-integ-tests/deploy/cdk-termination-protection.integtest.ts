import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'Termination protection',
  withDefaultFixture(async (fixture) => {
    const stackName = 'termination-protection';
    await fixture.cdkDeploy(stackName);

    // Try a destroy that should fail
    await expect(fixture.cdkDestroy(stackName)).rejects.toThrow('exited with error');

    // Can update termination protection even though the change set doesn't contain changes
    await fixture.cdkDeploy(stackName, { modEnv: { TERMINATION_PROTECTION: 'FALSE' } });
    await fixture.cdkDestroy(stackName); // test this now works
  }),
);

