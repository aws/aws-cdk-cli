import { integTest, withSpecificFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'test cdk rollback --force',
  withSpecificFixture('rollback-test-app', async (fixture) => {
    let phase = '1';

    // Should succeed
    await fixture.cdkDeploy('test-rollback', {
      options: ['--no-rollback'],
      modEnv: { PHASE: phase },
      verbose: false,
    });
    try {
      phase = '2b'; // Fail update and also fail rollback

      // Should fail
      const deployOutput = await fixture.cdkDeploy('test-rollback', {
        options: ['--no-rollback'],
        modEnv: { PHASE: phase },
        verbose: false,
        allowErrExit: true,
      });

      expect(deployOutput).toContain('UPDATE_FAILED');

      // Should still fail
      const rollbackOutput = await fixture.cdk(['rollback'], {
        modEnv: { PHASE: phase },
        verbose: false,
        allowErrExit: true,
      });

      expect(rollbackOutput).toContain('Failing rollback');

      // Rollback and force cleanup
      await fixture.cdk(['rollback', '--force'], {
        modEnv: { PHASE: phase },
        verbose: false,
      });
    } finally {
      await fixture.cdkDestroy('test-rollback');
    }
  }),
);

