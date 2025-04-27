import { integTest, withExtendedTimeoutFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'hotswap deployment for ecs service detects failed deployment and errors',
  withExtendedTimeoutFixture(async (fixture) => {
    // GIVEN
    await fixture.cdkDeploy('ecs-hotswap', { verbose: true });

    // WHEN
    const deployOutput = await fixture.cdkDeploy('ecs-hotswap', {
      options: ['--hotswap', '--hotswap-operation-timeout-seconds', '10'],
      modEnv: {
        USE_INVALID_ECS_HOTSWAP_IMAGE: 'true',
      },
      allowErrExit: true,
      verbose: true,
    });

    // THEN
    const expectedSubstring = 'Resource is not in the expected state due to waiter status: TIMEOUT';
    expect(deployOutput).toContain(expectedSubstring);
    expect(deployOutput).toContain('Observed responses:');
    expect(deployOutput).toContain('200: OK');
    expect(deployOutput).not.toContain('hotswapped!');
  }),
);

