import { integTest, withSpecificFixture } from '../../../lib';

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

    // Do a deployment with a replacement and removing --no-rollback: this will do a regular rollback deploy
    phase = '3';
    await fixture.cdkDeploy('test-rollback', {
      options: ['--force'],
      modEnv: { PHASE: phase },
      verbose: false,
    });
  }),
);

