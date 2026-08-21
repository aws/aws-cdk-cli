import { TELEMETRY_QUIET_PERIOD_MS } from './constants';
import { integTest, sleep, withDefaultFixture } from '../../lib';
import { startTelemetryEndpoint } from '../../lib/telemetry-endpoint';

/**
 * Opting out via the environment has to actually stop the data leaving the machine.
 *
 * The other disable tests assert on the CLI's own trace output, which only proves the sink was never
 * constructed. This points `TELEMETRY_ENDPOINT` at a real local server and proves nothing is POSTed
 * to it -- including by the detached child, which outlives the CLI and would therefore not show up in
 * its output at all.
 *
 * The endpoint's CA is still supplied, via `NODE_EXTRA_CA_CERTS`, even though nothing should reach it:
 * without a trusted CA "nothing arrived" would also be true of an ENABLED run whose TLS handshake
 * simply failed, and the test would pass for the wrong reason. Not `--ca-bundle-path`, which REPLACES
 * the trust store and breaks the SDK's own calls to public AWS endpoints.
 */
integTest(
  'CDK_DISABLE_CLI_TELEMETRY posts nothing to the endpoint',
  withDefaultFixture(async (fixture) => {
    const endpoint = await startTelemetryEndpoint({ certDirRoot: fixture.integTestDir });
    try {
      const output = await fixture.cdkSynth({
        options: [
          fixture.fullStackName('test-1'),
        ],
        modEnv: {
          CDK_HOME: fixture.integTestDir,
          TELEMETRY_ENDPOINT: endpoint.url,
          NODE_EXTRA_CA_CERTS: endpoint.caBundlePath,
          CDK_DISABLE_CLI_TELEMETRY: 'true',
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
