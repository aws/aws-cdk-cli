/**
 * Tests for the detached telemetry sender.
 *
 * These run the real thing: a real HTTPS server with a certificate signed by a throwaway CA, a
 * real HTTP CONNECT proxy, and a real SOCKS5 listener. Nothing here is mocked, because the whole
 * point of the sender is that it re-implements transport behaviour that we otherwise get from
 * `proxy-agent`, and a mock would not tell us whether it actually works on the wire.
 */
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { Readable } from 'node:stream';
import { generateTestCa, type TestCa } from './test-tls';
import { readAll, resolveProxy, sendTelemetry } from '../../../lib/cli/telemetry/sender';

jest.setTimeout(30_000);

interface Endpoint {
  readonly url: string;
  readonly received: Array<{ body: string; headers: http.IncomingHttpHeaders }>;
  close(): Promise<void>;
}

async function startEndpoint(ca: TestCa, options: { statusCode?: number; urlHost?: string } = {}): Promise<Endpoint> {
  const received: Array<{ body: string; headers: http.IncomingHttpHeaders }> = [];
  const server = https.createServer({ key: ca.serverKey, cert: ca.serverCert }, (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ body, headers: req.headers });
      res.writeHead(options.statusCode ?? 200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `https://${options.urlHost ?? 'localhost'}:${port}/metrics`,
    received,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

interface Proxy {
  readonly url: string;
  readonly connects: string[];
  readonly authHeaders: Array<string | undefined>;
  close(): Promise<void>;
}

interface ConnectProxyOptions {
  readonly requireAuth?: string;
  readonly delayConnectResponseMs?: number;
  readonly appendAfterConnectResponse?: string;
}

async function startConnectProxy(options: ConnectProxyOptions = {}): Promise<Proxy> {
  const connects: string[] = [];
  const authHeaders: Array<string | undefined> = [];
  const server = http.createServer((_req, res) => {
    res.writeHead(400);
    res.end('CONNECT only');
  });

  server.on('connect', (req, clientSocket, head) => {
    const auth = req.headers['proxy-authorization'];
    authHeaders.push(auth);
    if (options.requireAuth) {
      const expected = `Basic ${Buffer.from(options.requireAuth).toString('base64')}`;
      if (auth !== expected) {
        clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
        clientSocket.end();
        return;
      }
    }
    connects.push(req.url!);
    const [host, port] = req.url!.split(':');
    const upstream = net.connect(Number(port), host, () => {
      const established = () => {
        clientSocket.write(`HTTP/1.1 200 Connection Established\r\n\r\n${options.appendAfterConnectResponse ?? ''}`);
        if (head?.length) {
          upstream.write(head);
        }
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      };
      if (options.delayConnectResponseMs) {
        setTimeout(established, options.delayConnectResponseMs);
      } else {
        established();
      }
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });

  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    connects,
    authHeaders,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

const BODY = { events: [{ identifiers: { sessionId: 'test-session' } }] };

describe('sender', () => {
  let ca: TestCa;

  beforeAll(() => {
    ca = generateTestCa();
  });

  describe('direct delivery', () => {
    test('POSTs the payload and reports success', async () => {
      const endpoint = await startEndpoint(ca);
      try {
        const result = await sendTelemetry({ endpoint: endpoint.url, body: BODY, ca: ca.caCert, timeoutMs: 5000 }, {});

        expect(result).toEqual({ sent: true, via: 'direct', statusCode: 200, reason: undefined });
        expect(endpoint.received).toHaveLength(1);
        expect(JSON.parse(endpoint.received[0].body)).toEqual(BODY);
        expect(endpoint.received[0].headers['content-type']).toBe('application/json');
      } finally {
        await endpoint.close();
      }
    });

    test('reports a non-2xx status as not sent', async () => {
      const endpoint = await startEndpoint(ca, { statusCode: 500 });
      try {
        const result = await sendTelemetry({ endpoint: endpoint.url, body: BODY, ca: ca.caCert, timeoutMs: 5000 }, {});

        expect(result.sent).toBe(false);
        expect(result.statusCode).toBe(500);
        expect(result.reason).toContain('UnexpectedStatusCode');
      } finally {
        await endpoint.close();
      }
    });

    test('rejects an untrusted certificate when no CA is supplied', async () => {
      const endpoint = await startEndpoint(ca);
      try {
        const result = await sendTelemetry({ endpoint: endpoint.url, body: BODY, timeoutMs: 5000 }, {});

        expect(result.sent).toBe(false);
        expect(result.reason).toContain('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
        expect(endpoint.received).toHaveLength(0);
      } finally {
        await endpoint.close();
      }
    });

    test('reports connection failures without throwing', async () => {
      // Port 1 is reserved and nothing listens on it.
      const result = await sendTelemetry({ endpoint: 'https://127.0.0.1:1/metrics', body: BODY, timeoutMs: 2000 }, {});

      expect(result.sent).toBe(false);
      expect(result.via).toBe('direct');
      expect(result.reason).toContain('ECONNREFUSED');
    });
  });

  describe('proxy delivery', () => {
    test('tunnels through an http:// proxy with CONNECT', async () => {
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy();
      try {
        const result = await sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          ca: ca.caCert,
          timeoutMs: 5000,
        }, {});

        expect(result).toEqual({ sent: true, via: 'connect-tunnel', statusCode: 200, reason: undefined });
        expect(proxy.connects).toHaveLength(1);
        expect(proxy.connects[0]).toMatch(/^localhost:\d+$/);
        expect(JSON.parse(endpoint.received[0].body)).toEqual(BODY);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('sends Basic credentials embedded in the proxy URL', async () => {
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy({ requireAuth: 'alice:s3cret' });
      try {
        const authed = proxy.url.replace('http://', 'http://alice:s3cret@');
        const result = await sendTelemetry({ endpoint: endpoint.url, body: BODY, proxyUrl: authed, ca: ca.caCert, timeoutMs: 5000 }, {});

        expect(result.sent).toBe(true);
        expect(proxy.authHeaders[0]).toBe(`Basic ${Buffer.from('alice:s3cret').toString('base64')}`);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('surfaces a 407 from the proxy without throwing', async () => {
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy({ requireAuth: 'alice:s3cret' });
      try {
        const result = await sendTelemetry({ endpoint: endpoint.url, body: BODY, proxyUrl: proxy.url, ca: ca.caCert, timeoutMs: 5000 }, {});

        expect(result.sent).toBe(false);
        expect(result.via).toBe('connect-tunnel');
        expect(result.reason).toContain('407');
        expect(endpoint.received).toHaveLength(0);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('discovers the proxy from the environment when none is configured', async () => {
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy();
      try {
        const result = await sendTelemetry(
          { endpoint: endpoint.url, body: BODY, ca: ca.caCert, timeoutMs: 5000 },
          { HTTPS_PROXY: proxy.url },
        );

        expect(result.sent).toBe(true);
        expect(result.via).toBe('connect-tunnel');
        expect(proxy.connects).toHaveLength(1);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('honours NO_PROXY and goes direct', async () => {
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy();
      try {
        const result = await sendTelemetry(
          { endpoint: endpoint.url, body: BODY, ca: ca.caCert, timeoutMs: 5000 },
          { HTTPS_PROXY: proxy.url, NO_PROXY: 'localhost' },
        );

        expect(result.via).toBe('direct');
        expect(result.sent).toBe(true);
        expect(proxy.connects).toHaveLength(0);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('an explicit noProxy overrides the inherited NO_PROXY', async () => {
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy();
      try {
        const result = await sendTelemetry(
          { endpoint: endpoint.url, body: BODY, ca: ca.caCert, timeoutMs: 5000, noProxy: 'somewhere-else.example.com' },
          { HTTPS_PROXY: proxy.url, NO_PROXY: 'localhost' },
        );

        expect(result.via).toBe('connect-tunnel');
        expect(proxy.connects).toHaveLength(1);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    // Regression: the sender used to inherit the parent's 500ms exit budget and apply it to EVERY
    // step of a proxied send, so a proxy that took longer than that to establish the tunnel was
    // silently dropped. That is what broke this path on loaded CI runners.
    test('tolerates a proxy handshake slower than the old 500ms budget', async () => {
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy({ delayConnectResponseMs: 800 });
      try {
        // Deliberately no `timeoutMs`: this exercises the sender's own default budget.
        const result = await sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          ca: ca.caCert,
        }, {});

        expect(result).toEqual({ sent: true, via: 'connect-tunnel', statusCode: 200, reason: undefined });
        expect(JSON.parse(endpoint.received[0].body)).toEqual(BODY);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('still honours an explicit timeout when the proxy is too slow', async () => {
      // The budget was widened, not removed.
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy({ delayConnectResponseMs: 1500 });
      try {
        const result = await sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          ca: ca.caCert,
          timeoutMs: 300,
        }, {});

        expect(result.sent).toBe(false);
        expect(result.reason).toContain('ProxyConnectTimeout');
        expect(endpoint.received).toHaveLength(0);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('an explicitly empty proxy means direct, not environment auto-detect', async () => {
      // The parent forces whatever `--proxy` was set to, even an empty string, and does not consult
      // the environment in that case. The child has to agree, or the two disagree about whether a
      // proxy applies.
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy();
      try {
        const result = await sendTelemetry(
          { endpoint: endpoint.url, body: BODY, ca: ca.caCert, timeoutMs: 5000, proxyUrl: '' },
          { HTTPS_PROXY: proxy.url },
        );

        expect(result.via).toBe('direct');
        expect(result.sent).toBe(true);
        expect(proxy.connects).toHaveLength(0);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('replays bytes a proxy sends in the same chunk as its CONNECT response', async () => {
      // A proxy may coalesce tunnel bytes into the same write as `200 Connection Established`.
      // Those belong to the TLS stream and must not be dropped. Asserting that is awkward directly,
      // so this injects bytes that are NOT valid TLS: if they are replayed the handshake breaks
      // (which is what we assert), whereas if they were silently discarded it would succeed.
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy({ appendAfterConnectResponse: 'NOT-TLS' });
      try {
        const result = await sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          ca: ca.caCert,
          timeoutMs: 5000,
        }, {});

        expect(result.sent).toBe(false);
        expect(result.via).toBe('connect-tunnel');
        expect(endpoint.received).toHaveLength(0);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });
  });

  describe('certificate identity', () => {
    // Trusting the signer is not enough -- the certificate also has to cover the host we asked for.
    // Only the signer half used to be tested, which let a real gap through on the proxied path:
    // `tls.connect` was given no `host`, so for an IP-literal endpoint (where SNI must be omitted)
    // Node fell back to the underlying socket's host -- the PROXY -- and happily accepted a
    // certificate issued for the proxy's name.

    test('rejects a hostname mismatch on the direct path', async () => {
      const wrongCa = generateTestCa({ subjectAltName: 'DNS:not-the-endpoint.example.com' });
      const endpoint = await startEndpoint(wrongCa);
      try {
        const result = await sendTelemetry({ endpoint: endpoint.url, body: BODY, ca: wrongCa.caCert, timeoutMs: 5000 }, {});

        expect(result.sent).toBe(false);
        expect(result.via).toBe('direct');
        expect(result.reason).toContain('ERR_TLS_CERT_ALTNAME_INVALID');
        expect(endpoint.received).toHaveLength(0);
      } finally {
        await endpoint.close();
      }
    });

    test('rejects a hostname mismatch through a proxy', async () => {
      const wrongCa = generateTestCa({ subjectAltName: 'DNS:not-the-endpoint.example.com' });
      const endpoint = await startEndpoint(wrongCa);
      const proxy = await startConnectProxy();
      try {
        const result = await sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          ca: wrongCa.caCert,
          timeoutMs: 5000,
        }, {});

        expect(result.sent).toBe(false);
        expect(result.via).toBe('connect-tunnel');
        expect(result.reason).toContain('ERR_TLS_CERT_ALTNAME_INVALID');
        // The tunnel opened, but the handshake to the endpoint must not have.
        expect(proxy.connects).toHaveLength(1);
        expect(endpoint.received).toHaveLength(0);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('rejects an IP-literal endpoint whose certificate omits that IP, through a proxy', async () => {
      // The regression case. The certificate covers DNS:localhost but NOT IP:127.0.0.1, and the
      // proxy is reached as `localhost` -- so if identity were checked against the proxy's host
      // instead of the destination, this would be wrongly accepted.
      const localhostOnlyCa = generateTestCa({ subjectAltName: 'DNS:localhost' });
      const endpoint = await startEndpoint(localhostOnlyCa, { urlHost: '127.0.0.1' });
      const proxy = await startConnectProxy();
      try {
        const result = await sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          ca: localhostOnlyCa.caCert,
          timeoutMs: 5000,
        }, {});

        expect(result.sent).toBe(false);
        expect(result.via).toBe('connect-tunnel');
        expect(result.reason).toContain('ERR_TLS_CERT_ALTNAME_INVALID');
        expect(proxy.connects[0]).toMatch(/^127\.0\.0\.1:\d+$/);
        expect(endpoint.received).toHaveLength(0);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('accepts an IP-literal endpoint whose certificate does cover that IP, through a proxy', async () => {
      // The mirror image, so the test above is not just asserting that IP literals never work.
      const endpoint = await startEndpoint(ca, { urlHost: '127.0.0.1' });
      const proxy = await startConnectProxy();
      try {
        const result = await sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          ca: ca.caCert,
          timeoutMs: 5000,
        }, {});

        expect(result).toEqual({ sent: true, via: 'connect-tunnel', statusCode: 200, reason: undefined });
        expect(JSON.parse(endpoint.received[0].body)).toEqual(BODY);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });
  });

  describe('fails closed', () => {
    // A proxy is normally mandatory rather than advisory: corporate setups firewall direct egress.
    // Falling back to a direct connection would be both futile and a policy violation.
    test.each([
      'socks://127.0.0.1:1080',
      'socks4://127.0.0.1:1080',
      'socks5://127.0.0.1:1080',
      'socks5h://127.0.0.1:1080',
      'pac+http://127.0.0.1:8080/proxy.pac',
      'pac+https://127.0.0.1:8080/proxy.pac',
      'pac+file:///etc/proxy.pac',
      'pac+data:application/x-ns-proxy-autoconfig,foo',
    ])('skips (never falls back to direct) for %s', async (proxyUrl) => {
      const endpoint = await startEndpoint(ca);
      try {
        const result = await sendTelemetry({ endpoint: endpoint.url, body: BODY, proxyUrl, ca: ca.caCert, timeoutMs: 5000 }, {});

        expect(result.sent).toBe(false);
        expect(result.via).toBe('skipped');
        expect(result.reason).toMatch(/UnsupportedProxyProtocol/);
        // The critical assertion: nothing reached the endpoint directly.
        expect(endpoint.received).toHaveLength(0);
      } finally {
        await endpoint.close();
      }
    });

    test('skips a malformed proxy URL', async () => {
      const result = await sendTelemetry({ endpoint: 'https://example.com/m', body: BODY, proxyUrl: ':::not a url', timeoutMs: 500 }, {});

      expect(result).toMatchObject({ sent: false, via: 'skipped' });
      expect(result.reason).toContain('MalformedProxyUrl');
    });

    test.each([
      ['a missing endpoint', {}],
      ['an empty endpoint', { endpoint: '' }],
      ['a malformed endpoint', { endpoint: 'not-a-url' }],
    ])('skips %s without throwing', async (_name, cfg) => {
      const result = await sendTelemetry(cfg as any, {});

      expect(result.sent).toBe(false);
      expect(result.via).toBe('skipped');
    });

    test('never rejects, even on garbage input', async () => {
      await expect(sendTelemetry(undefined as any, {})).resolves.toMatchObject({ sent: false, via: 'skipped' });
      await expect(sendTelemetry(null as any, {})).resolves.toMatchObject({ sent: false, via: 'skipped' });
    });
  });

  describe('resolveProxy', () => {
    test('returns empty string for an unparseable endpoint', () => {
      expect(resolveProxy('not a url', { HTTPS_PROXY: 'http://corp:8080' })).toBe('');
    });

    test('prefixes a scheme-less proxy with the target scheme', () => {
      expect(resolveProxy('https://example.com/x', { HTTPS_PROXY: 'corp:8080' })).toBe('https://corp:8080');
    });

    test('does not use HTTP_PROXY for an https endpoint', () => {
      expect(resolveProxy('https://example.com/x', { HTTP_PROXY: 'http://corp:8080' })).toBe('');
    });
  });

  describe('readAll', () => {
    test('joins chunks and decodes as UTF-8', async () => {
      const stream = Readable.from([Buffer.from('{"a":'), Buffer.from('1}')]);

      await expect(readAll(stream, 1024)).resolves.toBe('{"a":1}');
    });

    test('decodes a multi-byte character split across two chunks', async () => {
      // '€' is E2 82 AC; feeding it as two chunks would corrupt a naive per-chunk decode.
      const euro = Buffer.from('€', 'utf-8');
      const stream = Readable.from([euro.subarray(0, 1), euro.subarray(1)]);

      await expect(readAll(stream, 1024)).resolves.toBe('€');
    });

    test('measures the cap in bytes, not UTF-16 code units', async () => {
      // 10 x '€' is 10 UTF-16 code units but 30 bytes. A cap compared against string `.length`
      // would wave this through at a 20 byte limit; it must not.
      const payload = Buffer.from('€'.repeat(10), 'utf-8');
      expect(payload.byteLength).toBe(30);

      await expect(readAll(Readable.from([payload]), 20)).resolves.toBeUndefined();
      await expect(readAll(Readable.from([payload]), 30)).resolves.toBe('€'.repeat(10));
    });

    test('gives up once the running total exceeds the cap', async () => {
      const stream = Readable.from([Buffer.alloc(8, 0x61), Buffer.alloc(8, 0x61)]);

      await expect(readAll(stream, 10)).resolves.toBeUndefined();
    });

    test('accepts a payload exactly at the cap', async () => {
      const stream = Readable.from([Buffer.alloc(10, 0x61)]);

      await expect(readAll(stream, 10)).resolves.toBe('a'.repeat(10));
    });

    test('resolves undefined on a stream error rather than rejecting', async () => {
      const stream = new Readable({
        read() {
          this.destroy(new Error('EPIPE'));
        },
      });

      await expect(readAll(stream, 1024)).resolves.toBeUndefined();
    });

    test('tolerates string chunks', async () => {
      // Defensive: nothing calls setEncoding today, but a future change must not silently break
      // the byte accounting.
      const stream = Readable.from(['hello']);

      await expect(readAll(stream, 1024)).resolves.toBe('hello');
    });
  });
});
