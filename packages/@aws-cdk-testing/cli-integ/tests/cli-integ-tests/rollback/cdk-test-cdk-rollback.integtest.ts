import { integTest, withSpecificFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'test cdk rollback',
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

    // Rollback
    await fixture.cdk(['rollback'], {
      modEnv: { PHASE: phase },
      verbose: false,
    });
  }),
);

