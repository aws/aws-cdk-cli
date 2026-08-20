import { TELEMETRY_QUIET_PERIOD_MS } from './constants';
import { integTest, sleep, withDefaultFixture } from '../../lib';
import { startTelemetryEndpoint } from '../../lib/telemetry-endpoint';

/**
 * Opting out via the persisted setting has to actually stop the data leaving the machine.
 *
 * `cli-telemetry --disable` writes to the CDK context rather than reading an environment variable, so
 * it reaches the same decision by a different route than
 * `cdk-telemetry-disabled-posts-nothing`. Proven the same way: a real local endpoint, and nothing
 * POSTed to it by the CLI or by the detached child that outlives it.
 */
integTest(
  'cli-telemetry --disable posts nothing to the endpoint',
  withDefaultFixture(async (fixture) => {
    const endpoint = await startTelemetryEndpoint({ certDirRoot: fixture.integTestDir });
    try {
      await fixture.cdk(['cli-telemetry', '--disable'], {
        modEnv: {
          CDK_HOME: fixture.integTestDir,
          TELEMETRY_ENDPOINT: endpoint.url,
        },
      });

      const output = await fixture.cdkSynth({
        options: [
          fixture.fullStackName('test-1'),
          '--ca-bundle-path', endpoint.caBundlePath,
        ],
        modEnv: {
          CDK_HOME: fixture.integTestDir,
          TELEMETRY_ENDPOINT: endpoint.url,
        },
        verboseLevel: 3, // trace
      });

      expect(output).toContain('Telemetry disabled');

      await sleep(TELEMETRY_QUIET_PERIOD_MS);

      expect(await endpoint.batches()).toEqual([]);
    } finally {
      await endpoint.dispose();
    }
  }),
);
