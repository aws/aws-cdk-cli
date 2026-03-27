import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'automatic rollback if paused and change contains a replacement',
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

    // Do a deployment with a replacement and --force: this will roll back first and then deploy normally
    phase = '3';
    await fixture.cdkDeploy('test-rollback', {
      options: ['--no-rollback', '--force'],
      modEnv: { PHASE: phase },
      verbose: false,
    });
  }),
);

