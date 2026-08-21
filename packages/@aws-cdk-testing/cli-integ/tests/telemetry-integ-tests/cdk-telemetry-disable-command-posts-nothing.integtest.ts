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
 *
 * The endpoint's CA is still supplied, via `NODE_EXTRA_CA_CERTS`, even though nothing should reach it:
 * without a trusted CA "nothing arrived" would also be true of an ENABLED run whose TLS handshake
 * simply failed, and the test would pass for the wrong reason. Not `--ca-bundle-path`, which REPLACES
 * the trust store and breaks the SDK's own calls to public AWS endpoints.
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
        ],
        modEnv: {
          CDK_HOME: fixture.integTestDir,
          TELEMETRY_ENDPOINT: endpoint.url,
          NODE_EXTRA_CA_CERTS: endpoint.caBundlePath,
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
