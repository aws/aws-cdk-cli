import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withExtendedTimeoutFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'hotswap deployment for ecs service detects failed deployment and errors',
  withExtendedTimeoutFixture(async (fixture) => {
    // GIVEN
    await fixture.cdkDeploy('ecs-hotswap', { verbose: true });

    const cdkJson = {
      ...JSON.parse(await fs.readFile(path.join(fixture.integTestDir, 'cdk.json'), 'utf8')),
      hotswap: {
        ecs: {
          stabilizationTimeoutSeconds: 200,
        },
      },
    };

    await fs.writeFile(path.join(fixture.integTestDir, 'cdk.json'), JSON.stringify(cdkJson));

    // WHEN
    const deployOutput = await fixture.cdkDeploy('ecs-hotswap', {
      options: ['--hotswap'],
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

