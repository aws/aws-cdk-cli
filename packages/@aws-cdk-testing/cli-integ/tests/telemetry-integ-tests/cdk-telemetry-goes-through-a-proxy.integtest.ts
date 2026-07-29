import { integTest, withDefaultFixture } from '../../lib';
import { startProxyServer } from '../../lib/proxy';

/**
 * Telemetry has to keep working for users behind a corporate proxy.
 *
 * This matters more than it looks. The POST is made by a detached child process that has no access
 * to the parent's `proxy-agent` instance -- it only has Node built-ins -- so it re-implements HTTP
 * CONNECT tunnelling and has to be handed the proxy URL and CA bundle explicitly. This test proves
 * that hand-off end to end against the same TLS-terminating proxy the other proxy tests use, whose
 * certificate is signed by a throwaway CA that is not in any system trust store.
 */
integTest(
  'telemetry is delivered through a configured proxy',
  withDefaultFixture(async (fixture) => {
    const proxyServer = await startProxyServer();
    try {
      const output = await fixture.cdkSynth({
        options: [
          fixture.fullStackName('test-1'),
          '--proxy', proxyServer.url,
          '--ca-bundle-path', proxyServer.certPath,
        ],
        modEnv: {
          CDK_HOME: fixture.integTestDir,
        },
        verboseLevel: 3, // trace
      });

      // The parent reports the hand-off, not the delivery.
      expect(output).toContain('Telemetry dispatched');

      // Delivery happens after the CLI exits, so poll rather than asserting immediately.
      const telemetryRequest = await waitFor(
        async () => {
          const requests = await proxyServer.getSeenRequests();
          return requests.find((req) => req.url.includes('cdk-cli-telemetry'));
        },
        30_000,
      );

      expect(telemetryRequest).toBeDefined();
      expect(telemetryRequest!.method).toBe('POST');

      // The proxy terminates TLS, so we can read the decrypted body and confirm the child sent a
      // well-formed batch (and therefore that both the proxy URL and the CA made it across).
      const body = JSON.parse(telemetryRequest!.body.buffer.toString('utf-8'));
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.events.length).toBeGreaterThan(0);
      expect(body.events[0]).toEqual(expect.objectContaining({
        identifiers: expect.objectContaining({ sessionId: expect.anything() }),
      }));
    } finally {
      await proxyServer.stop();
    }
  }),
);

/**
 * Poll `fn` until it returns something truthy, or give up after `timeoutMs`.
 */
async function waitFor<A>(fn: () => Promise<A | undefined>, timeoutMs: number): Promise<A | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) {
      return result;
    }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return undefined;
}
