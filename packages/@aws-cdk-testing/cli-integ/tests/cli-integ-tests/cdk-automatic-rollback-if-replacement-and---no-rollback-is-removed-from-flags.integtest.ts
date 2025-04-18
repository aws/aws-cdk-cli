import { integTest, withSpecificFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'automatic rollback if replacement and --no-rollback is removed from flags',
  withSpecificFixture('rollback-test-app', async (fixture) => {
    let phase = '1';

    // Should succeed
    await fixture.cdkDeploy('test-rollback', {
      options: ['--no-rollback'],
      modEnv: { PHASE: phase },
      verbose: false,
    });
    try {
      // Do a deployment with a replacement and removing --no-rollback: this will do a regular rollback deploy
      phase = '3';
      await fixture.cdkDeploy('test-rollback', {
        options: ['--force'],
        modEnv: { PHASE: phase },
        verbose: false,
      });
    } finally {
      await fixture.cdkDestroy('test-rollback');
    }
  }),
);

