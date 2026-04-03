import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'automatic rollback if paused and --no-rollback is removed from flags',
  withSpecificFixture('rollback-test-app', async (fixture) => {
    let phase = '1';

    // Should succeed
    await fixture.cdkDeploy('test-rollback', {
      options: ['--no-rollback'],
      modEnv: { PHASE: phase },
      verbose: false,
    });

    phase = '2a';

    // Should fail
    const deployOutput = await fixture.cdkDeploy('test-rollback', {
      options: ['--no-rollback'],
      modEnv: { PHASE: phase },
      verbose: false,
      allowErrExit: true,
    });
    expect(deployOutput).toContain('UPDATE_FAILED');

    // Do a deployment removing --no-rollback: this will roll back first and then deploy normally
    phase = '1';
    await fixture.cdkDeploy('test-rollback', {
      options: ['--force'],
      modEnv: { PHASE: phase },
      verbose: false,
    });
  }),
);

