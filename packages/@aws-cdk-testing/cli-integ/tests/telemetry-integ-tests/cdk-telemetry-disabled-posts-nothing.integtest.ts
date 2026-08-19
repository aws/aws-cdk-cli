import { integTest, withDefaultFixture } from '../../lib';
import { startTelemetryEndpoint } from '../../lib/telemetry-endpoint';

/**
 * How long to keep watching the endpoint after the CLI has exited.
 *
 * Delivery is asynchronous, so "nothing arrived" is only meaningful once we have waited longer than a
 * successful delivery would have taken. The companion positive test normally sees the batch within a
 * second or two.
 */
const QUIET_PERIOD_MS = 10_000;

/**
 * Opting out has to actually stop the data leaving the machine.
 *
 * The existing disable tests assert on the CLI's own trace output, which only proves the sink was
 * never constructed. This points `TELEMETRY_ENDPOINT` at a real local server and proves nothing is
 * POSTed to it -- including by the detached child, which outlives the CLI and would therefore not
 * show up in its output at all.
 */
integTest(
  'CDK_DISABLE_CLI_TELEMETRY posts nothing to the endpoint',
  withDefaultFixture(async (fixture) => {
    const endpoint = await startTelemetryEndpoint({ certDirRoot: fixture.integTestDir });
    try {
      const output = await fixture.cdkSynth({
        options: [
          fixture.fullStackName('test-1'),
          '--ca-bundle-path', endpoint.caBundlePath,
        ],
        modEnv: {
          CDK_HOME: fixture.integTestDir,
          TELEMETRY_ENDPOINT: endpoint.url,
          CDK_DISABLE_CLI_TELEMETRY: 'true',
        },
        verboseLevel: 3, // trace
      });

      expect(output).toContain('Endpoint Telemetry NOT connected');

      await new Promise((ok) => setTimeout(ok, QUIET_PERIOD_MS));

      expect(await endpoint.batches()).toEqual([]);
    } finally {
      await endpoint.dispose();
    }
  }),
);

/**
 * Same again for the persisted setting, which is a different code path from the environment variable.
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

      expect(output).toContain('Endpoint Telemetry NOT connected');

      await new Promise((ok) => setTimeout(ok, QUIET_PERIOD_MS));

      expect(await endpoint.batches()).toEqual([]);
    } finally {
      await endpoint.dispose();
    }
  }),
);
