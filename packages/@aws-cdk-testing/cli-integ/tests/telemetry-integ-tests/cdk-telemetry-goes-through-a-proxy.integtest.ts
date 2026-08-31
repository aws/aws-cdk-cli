import * as https from 'node:https';
import type { AddressInfo } from 'node:net';
import * as mockttp from 'mockttp';
import { integTest, withDefaultFixture } from '../../lib';
import { startProxyServer } from '../../lib/proxy';
import { waitFor } from '../../lib/telemetry-endpoint';

/**
 * Telemetry has to keep working for users behind a corporate proxy.
 *
 * The POST is made by a detached child process, which cannot be handed the parent's `proxy-agent`
 * instance, so the proxy URL and the CA bundle path are forwarded to it as plain data and it builds
 * its own agent. This proves that hand-off end to end against the same TLS-terminating proxy the
 * other proxy tests use, whose certificate is signed by a throwaway CA that is in no system trust
 * store.
 *
 * `TELEMETRY_ENDPOINT` points at a local server, so the test neither needs egress to production nor
 * posts real telemetry from CI. What is under test is the CLI -> proxy hop: that the child opened a
 * CONNECT tunnel and completed a TLS handshake against a certificate it could only have verified
 * using the forwarded CA. The proxy -> endpoint hop is deliberately out of scope (the proxy will not
 * trust the local server's self-signed certificate, which does not matter -- the proxy records the
 * decrypted request either way).
 */
integTest(
  'telemetry is delivered through a configured proxy',
  withDefaultFixture(async (fixture) => {
    // Stand-in for the telemetry endpoint. Never actually serves a response to the proxy; it only
    // needs to occupy a port so the CONNECT target is real.
    const { key, cert } = await mockttp.generateCACertificate();
    const endpointServer = https.createServer({ key, cert }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((ok) => endpointServer.listen(0, '127.0.0.1', ok));
    const endpointPort = (endpointServer.address() as AddressInfo).port;
    const telemetryEndpoint = `https://localhost:${endpointPort}/metrics`;

    const proxyServer = await startProxyServer();
    try {
      await fixture.cdkSynth({
        options: [
          fixture.fullStackName('test-1'),
          '--proxy', proxyServer.url,
          '--ca-bundle-path', proxyServer.certPath,
        ],
        modEnv: {
          CDK_HOME: fixture.integTestDir,
          TELEMETRY_ENDPOINT: telemetryEndpoint,
        },
        verboseLevel: 3, // trace
      });

      // Delivery happens after the CLI exits, so poll rather than asserting immediately.
      const telemetryRequest = await waitFor(
        async () => {
          const requests = await proxyServer.getSeenRequests();
          return requests.find((req) => req.url.includes(`localhost:${endpointPort}`));
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
      expect(telemetryRequest!.body.buffer.toString('utf-8')).not.toContain('BEGIN CERTIFICATE');
    } finally {
      await proxyServer.stop();
      await new Promise<void>((ok) => endpointServer.close(() => ok()));
    }
  }),
);
