import { TELEMETRY_QUIET_PERIOD_MS } from './constants';
import { integTest, sleep, withDefaultFixture } from '../../lib';
import { startTelemetryEndpoint } from '../../lib/telemetry-endpoint';

/**
 * Opting out must not itself phone home.
 *
 * `canCollectTelemetry` special-cases `cdk cli-telemetry --disable` (the persisted setting is only
 * written by that very run, so it cannot be what suppresses it), which is a different route to the
 * same decision than `cdk-telemetry-disable-command-posts-nothing`: that one proves a SUBSEQUENT
 * command respects the setting this one writes, whereas this proves the writing run sends nothing.
 * Asserted against a real local endpoint rather than the CLI's trace output, because the POST is made
 * by a detached child that outlives the CLI and so would not show up in its output at all.
 *
 * The endpoint's CA is still supplied, via `NODE_EXTRA_CA_CERTS`, even though nothing should reach it:
 * without a trusted CA "nothing arrived" would also be true of an ENABLED run whose TLS handshake
 * simply failed, and the test would pass for the wrong reason. Not `--ca-bundle-path`, which REPLACES
 * the trust store and breaks the SDK's own calls to public AWS endpoints.
 */
integTest(
  'CLI Telemetry --disable does not send to endpoint',
  withDefaultFixture(async (fixture) => {
    const endpoint = await startTelemetryEndpoint({ certDirRoot: fixture.integTestDir });
    try {
      await fixture.cdk(['cli-telemetry', '--disable'], {
        modEnv: {
          CDK_HOME: fixture.integTestDir,
          TELEMETRY_ENDPOINT: endpoint.url,
          NODE_EXTRA_CA_CERTS: endpoint.caBundlePath,
        },
        verboseLevel: 3, // trace
      });

      await sleep(TELEMETRY_QUIET_PERIOD_MS);

      expect(await endpoint.batches()).toEqual([]);
    } finally {
      await endpoint.dispose();
    }
  }),
);
