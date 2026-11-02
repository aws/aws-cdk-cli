import { integTest, withDefaultFixture } from '../../lib';
import { startTelemetryEndpoint } from '../../lib/telemetry-endpoint';

/**
 * Telemetry has to actually arrive, not merely be handed off.
 *
 * The POST is made by a detached child process, so the CLI's own output can only ever say that the
 * batch was dispatched. This points `TELEMETRY_ENDPOINT` at a local HTTPS server and waits for the
 * request to turn up there, which is the only assertion that covers the whole chain: the temp-file
 * hand-off, resolving and spawning the sender, forwarding the CA bundle path, and the POST itself.
 *
 * The endpoint's certificate is signed by a throwaway CA that is in no system trust store, so
 * delivery only succeeds if the sender really trusts that CA.
 *
 * That CA is supplied through `NODE_EXTRA_CA_CERTS` rather than `--ca-bundle-path`, because the two do
 * different things: `--ca-bundle-path` REPLACES the trust store for the whole CLI, which also breaks
 * the SDK's own calls to public AWS endpoints (`STS.GetCallerIdentity` fails to find an issuer, the
 * default account never resolves, and the app exits before any of this is reached).
 * `NODE_EXTRA_CA_CERTS` adds to the store instead, so public roots keep working. The forwarding of
 * `caBundlePath` through the payload is covered where it can be asserted in isolation: the
 * `reads the CA bundle from the path it was given` sender test, and the proxy integ test.
 */
integTest(
  'telemetry is delivered to the endpoint',
  withDefaultFixture(async (fixture) => {
    const endpoint = await startTelemetryEndpoint({ certDirRoot: fixture.integTestDir });
    try {
      await fixture.cdkSynth({
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

      // Delivery happens after the CLI exits, so poll rather than asserting immediately.
      const batch = await endpoint.waitForBatch();

      expect(batch).toBeDefined();
      expect(Array.isArray(batch!.events)).toBe(true);
      expect(batch!.events.length).toBeGreaterThan(0);
      expect(batch!.events[0]).toEqual(expect.objectContaining({
        identifiers: expect.objectContaining({ sessionId: expect.anything() }),
      }));

      // The certificate must have travelled as a path, not as bytes in the payload: a real system
      // bundle is ~190KB, and inlining it would tie every batch's size to the CA bundle's.
      expect(JSON.stringify(batch)).not.toContain('BEGIN CERTIFICATE');
    } finally {
      await endpoint.dispose();
    }
  }),
);
