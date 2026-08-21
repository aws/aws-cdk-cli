/**
 * Tests for the detached telemetry sender.
 *
 * These run the real thing: a real HTTPS server with a certificate signed by a throwaway CA, a real
 * HTTP CONNECT proxy, and a real SOCKS5 proxy. Nothing here is mocked -- the sender's whole job is
 * transport behaviour, and a mock would not tell us whether it actually works on the wire.
 */
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { cleanupTestCas, generateTestCa, type TestCa } from './test-tls';
import { isSuccess, sendTelemetry } from '../../../lib/cli/telemetry/sender';

jest.setTimeout(30_000);

/**
 * Anything we hold on to purely so that teardown can drop it.
 */
interface Destroyable {
  destroy(): void;
}

/**
 * Shut a test server down deterministically.
 *
 * `server.close()` only resolves once every connection has gone, and a CONNECT tunnel is held open
 * by the client (which is an agent with its own pooling policy), so waiting for that would make
 * teardown depend on the agent's socket lifetime. Drop the sockets ourselves instead.
 */
function shutdown(server: net.Server, sockets: Destroyable[]): () => Promise<void> {
  return () => new Promise<void>((ok) => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close(() => ok());
  });
}

interface Endpoint {
  readonly url: string;
  readonly received: Array<{ body: string; headers: http.IncomingHttpHeaders }>;
  close(): Promise<void>;
}

async function startEndpoint(ca: TestCa, options: { statusCode?: number; urlHost?: string } = {}): Promise<Endpoint> {
  const received: Array<{ body: string; headers: http.IncomingHttpHeaders }> = [];
  const sockets: Destroyable[] = [];
  const server = https.createServer({ key: ca.serverKey, cert: ca.serverCert }, (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ body, headers: req.headers });
      res.writeHead(options.statusCode ?? 200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  server.on('connection', (socket) => sockets.push(socket));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as net.AddressInfo).port;
  return {
    // Deliberately a hostname by default: the NO_PROXY and CONNECT-target tests below asserts on it.
    // Tests that do not care about the hostname pass `urlHost: '127.0.0.1'` to avoid depending on how
    // `localhost` resolves.
    url: `https://${options.urlHost ?? 'localhost'}:${port}/metrics`,
    received,
    close: shutdown(server, sockets),
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
}

async function startConnectProxy(options: ConnectProxyOptions = {}): Promise<Proxy> {
  const connects: string[] = [];
  const authHeaders: Array<string | undefined> = [];
  const sockets: Destroyable[] = [];
  const server = http.createServer((_req, res) => {
    res.writeHead(400);
    res.end('CONNECT only');
  });
  server.on('connection', (socket) => sockets.push(socket));

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
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
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
    sockets.push(upstream);
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });

  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    connects,
    authHeaders,
    close: shutdown(server, sockets),
  };
}

/**
 * A real (if minimal) SOCKS5 proxy: no authentication, CONNECT command only.
 *
 * Exists because SOCKS is the capability the hand-rolled sender could not support and this one can.
 * Speaking the actual protocol is the only way to prove that.
 */
async function startSocks5Proxy(): Promise<Proxy> {
  const connects: string[] = [];
  const sockets: Destroyable[] = [];
  const server = net.createServer((client) => {
    sockets.push(client);
    let stage: 'greeting' | 'request' | 'piping' = 'greeting';
    let buffered = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      if (stage === 'piping') {
        return;
      }
      buffered = Buffer.concat([buffered, chunk]);

      if (stage === 'greeting') {
        // VER | NMETHODS | METHODS...
        if (buffered.length < 2 || buffered.length < 2 + buffered[1]) {
          return;
        }
        buffered = buffered.subarray(2 + buffered[1]);
        stage = 'request';
        client.write(Buffer.from([0x05, 0x00])); // no authentication required
      }

      if (stage === 'request') {
        // VER | CMD | RSV | ATYP | ADDR | PORT
        if (buffered.length < 4) {
          return;
        }
        const atyp = buffered[3];
        let host: string;
        let offset: number;
        if (atyp === 0x01) {
          if (buffered.length < 10) {
            return;
          }
          host = Array.from(buffered.subarray(4, 8)).join('.');
          offset = 8;
        } else if (atyp === 0x03) {
          const len = buffered[4];
          if (buffered.length < 5 + len + 2) {
            return;
          }
          host = buffered.subarray(5, 5 + len).toString('utf-8');
          offset = 5 + len;
        } else {
          client.end();
          return;
        }
        const port = buffered.readUInt16BE(offset);
        connects.push(`${host}:${port}`);
        stage = 'piping';

        const upstream = net.connect(port, host, () => {
          // VER | REP=success | RSV | ATYP=IPv4 | BND.ADDR | BND.PORT
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          client.pipe(upstream);
          upstream.pipe(client);
        });
        sockets.push(upstream);
        upstream.on('error', () => client.destroy());
        client.on('error', () => upstream.destroy());
      }
    };

    client.on('data', onData);
    client.on('error', () => client.destroy());
  });

  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `socks5://127.0.0.1:${port}`,
    connects,
    authHeaders: [],
    close: shutdown(server, sockets),
  };
}

/**
 * An HTTPS endpoint that completes the handshake, reads the request, and then never answers.
 *
 * Exercises the sender's request budget: the connection is perfectly healthy, so only the timeout
 * can end the attempt.
 */
async function startStalledEndpoint(ca: TestCa): Promise<Endpoint> {
  const sockets: Destroyable[] = [];
  const server = https.createServer({ key: ca.serverKey, cert: ca.serverCert }, () => {
    // Deliberately no response.
  });
  server.on('connection', (socket) => sockets.push(socket));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as net.AddressInfo).port;
  return {
    // Connect by IP, matching the bind address. No test here cares about the hostname, and resolving
    // `localhost` to ::1 first -- which Node 18+ does on a dual-stack box -- would ECONNREFUSED
    // against a listener bound only to 127.0.0.1. Covered by the certificate's `IP:127.0.0.1` SAN.
    url: `https://127.0.0.1:${port}/metrics`,
    received: [],
    close: shutdown(server, sockets),
  };
}

const BODY = { events: [{ identifiers: { sessionId: 'test-session' } }] as any };

/**
 * Assert that delivery failed, and describe how.
 *
 * Node reports transport problems in `code` (`ECONNREFUSED`, `ERR_TLS_CERT_ALTNAME_INVALID`) while
 * our own failures arrive as an error `name`, so tests should not have to know which one carries the
 * detail.
 */
function failure(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => {
      throw new Error('expected delivery to fail, but it succeeded');
    },
    (e: any) => `${e?.code ?? ''}|${e?.name ?? ''}|${e?.message ?? ''}`,
  );
}

describe('sender', () => {
  let ca: TestCa;
  const savedEnv = { ...process.env };

  beforeAll(() => {
    ca = generateTestCa();
  });

  afterAll(() => {
    cleanupTestCas();
  });

  afterEach(() => {
    // `proxy-agent` reads the proxy environment directly, so tests that exercise auto-detection have
    // to mutate it for real.
    for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy']) {
      delete process.env[key];
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      }
    }
  });

  describe('direct delivery', () => {
    test('POSTs the payload and reports success', async () => {
      const endpoint = await startEndpoint(ca);
      try {
        await expect(sendTelemetry({ endpoint: endpoint.url, body: BODY, caBundlePath: ca.caCertPath, timeoutMs: 5000 })).resolves.toBe(200);

        expect(endpoint.received).toHaveLength(1);
        expect(JSON.parse(endpoint.received[0].body)).toEqual(BODY);
        expect(endpoint.received[0].headers['content-type']).toBe('application/json');
      } finally {
        await endpoint.close();
      }
    });

    test('reports a non-2xx status without treating it as delivered', async () => {
      const endpoint = await startEndpoint(ca, { statusCode: 500 });
      try {
        const statusCode = await sendTelemetry({ endpoint: endpoint.url, body: BODY, caBundlePath: ca.caCertPath, timeoutMs: 5000 });

        expect(statusCode).toBe(500);
        expect(isSuccess(statusCode)).toBe(false);
      } finally {
        await endpoint.close();
      }
    });

    test('rejects an untrusted certificate when no CA bundle is supplied', async () => {
      const endpoint = await startEndpoint(ca);
      try {
        await expect(failure(sendTelemetry({ endpoint: endpoint.url, body: BODY, timeoutMs: 5000 })))
          .resolves.toContain('UNABLE_TO_VERIFY_LEAF_SIGNATURE');

        expect(endpoint.received).toHaveLength(0);
      } finally {
        await endpoint.close();
      }
    });

    test('reports connection failures by rejecting', async () => {
      // Port 1 is reserved and nothing listens on it.
      await expect(failure(sendTelemetry({ endpoint: 'https://127.0.0.1:1/metrics', body: BODY, timeoutMs: 2000 })))
        .resolves.toContain('ECONNREFUSED');
    });

    test('a CA bundle path that does not exist falls back to the system trust store', async () => {
      // Rather than crashing or silently trusting everything: the endpoint's certificate is not
      // signed by a public root, so this must fail verification.
      const endpoint = await startEndpoint(ca);
      try {
        await expect(failure(sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          caBundlePath: '/definitely/not/a/real/bundle.pem',
          timeoutMs: 5000,
        }))).resolves.toContain('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
      } finally {
        await endpoint.close();
      }
    });
  });

  describe('proxy delivery', () => {
    test('tunnels through an http:// proxy with CONNECT', async () => {
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy();
      try {
        await expect(sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          caBundlePath: ca.caCertPath,
          timeoutMs: 5000,
        })).resolves.toBe(200);

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
        await expect(sendTelemetry({
          endpoint: endpoint.url, body: BODY, proxyUrl: authed, caBundlePath: ca.caCertPath, timeoutMs: 5000,
        })).resolves.toBe(200);

        expect(proxy.authHeaders[0]).toBe(`Basic ${Buffer.from('alice:s3cret').toString('base64')}`);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('surfaces a proxy 407 as a status code, not as a delivery', async () => {
      // `https-proxy-agent` replays a non-200 CONNECT response through the HTTP machinery (and
      // destroys the original socket so the request body is never written to the proxy), so this
      // arrives as an ordinary status code for the caller to judge.
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy({ requireAuth: 'alice:s3cret' });
      try {
        const statusCode = await sendTelemetry({
          endpoint: endpoint.url, body: BODY, proxyUrl: proxy.url, caBundlePath: ca.caCertPath, timeoutMs: 5000,
        });

        expect(statusCode).toBe(407);
        expect(isSuccess(statusCode)).toBe(false);
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
        process.env.HTTPS_PROXY = proxy.url;

        await expect(sendTelemetry({ endpoint: endpoint.url, body: BODY, caBundlePath: ca.caCertPath, timeoutMs: 5000 })).resolves.toBe(200);

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
        process.env.HTTPS_PROXY = proxy.url;
        process.env.NO_PROXY = 'localhost';

        await expect(sendTelemetry({ endpoint: endpoint.url, body: BODY, caBundlePath: ca.caCertPath, timeoutMs: 5000 })).resolves.toBe(200);

        expect(proxy.connects).toHaveLength(0);
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
        process.env.HTTPS_PROXY = proxy.url;

        await expect(sendTelemetry({ endpoint: endpoint.url, body: BODY, caBundlePath: ca.caCertPath, timeoutMs: 5000, proxyUrl: '' })).resolves.toBe(200);

        expect(proxy.connects).toHaveLength(0);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('tolerates a proxy handshake slower than the in-process 500ms budget', async () => {
      // Regression: the sender used to inherit the parent's 500ms exit budget and apply it to EVERY
      // step of a proxied send, so a proxy that took longer than that to establish the tunnel was
      // silently dropped. That is what broke this path on loaded CI runners.
      const endpoint = await startEndpoint(ca);
      const proxy = await startConnectProxy({ delayConnectResponseMs: 800 });
      try {
        // Deliberately no `timeoutMs`: this exercises the sender's own default budget.
        await expect(sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          caBundlePath: ca.caCertPath,
        })).resolves.toBe(200);

        expect(JSON.parse(endpoint.received[0].body)).toEqual(BODY);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('gives up on an endpoint that accepts the connection but never responds', async () => {
      // The budget was widened, not removed.
      const stalled = await startStalledEndpoint(ca);
      try {
        await expect(failure(sendTelemetry({
          endpoint: stalled.url,
          body: BODY,
          caBundlePath: ca.caCertPath,
          timeoutMs: 300,
        }))).resolves.toContain('RequestTimeout');
      } finally {
        await stalled.close();
      }
    });
  });

  describe('SOCKS support', () => {
    // The reason this sender reuses `proxy-agent` instead of hand-rolling HTTP CONNECT: a
    // builtins-only sender cannot speak SOCKS, so it had to skip these users entirely.
    //
    // These two address the endpoint by IP rather than by name, because `socks5://` (unlike
    // `socks5h://`) resolves the destination on THIS side and puts the resulting address in the SOCKS
    // request. Given a hostname, what lands there depends on how `localhost` happens to resolve: an
    // IPv6-first box sends an ATYP=0x04 address, which `startSocks5Proxy` below does not implement,
    // and the connection is closed rather than proxied. A literal IPv4 address is not resolved at all,
    // so the request shape is the same everywhere. Covered by the certificate's `IP:127.0.0.1` SAN.
    test('delivers through a socks5:// proxy', async () => {
      const endpoint = await startEndpoint(ca, { urlHost: '127.0.0.1' });
      const proxy = await startSocks5Proxy();
      try {
        await expect(sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          caBundlePath: ca.caCertPath,
          timeoutMs: 5000,
        })).resolves.toBe(200);

        expect(proxy.connects).toHaveLength(1);
        expect(JSON.parse(endpoint.received[0].body)).toEqual(BODY);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('discovers a socks5:// proxy from the environment', async () => {
      const endpoint = await startEndpoint(ca, { urlHost: '127.0.0.1' });
      const proxy = await startSocks5Proxy();
      try {
        process.env.HTTPS_PROXY = proxy.url;

        await expect(sendTelemetry({ endpoint: endpoint.url, body: BODY, caBundlePath: ca.caCertPath, timeoutMs: 5000 })).resolves.toBe(200);

        expect(proxy.connects).toHaveLength(1);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });
  });

  describe('fails closed', () => {
    test('does not fall back to a direct connection when the proxy is unreachable', async () => {
      // A proxy is normally mandatory rather than advisory: corporate setups firewall direct egress,
      // so bypassing it would be both futile and a policy violation.
      const endpoint = await startEndpoint(ca);
      try {
        await expect(sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: 'http://127.0.0.1:1',
          caBundlePath: ca.caCertPath,
          timeoutMs: 5000,
        })).rejects.toThrow();

        expect(endpoint.received).toHaveLength(0);
      } finally {
        await endpoint.close();
      }
    });

    test('rejects a proxy address with an unsupported protocol', async () => {
      const endpoint = await startEndpoint(ca);
      try {
        await expect(sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: 'gopher://127.0.0.1:70',
          caBundlePath: ca.caCertPath,
          timeoutMs: 5000,
        })).rejects.toThrow(/Unsupported protocol/);

        expect(endpoint.received).toHaveLength(0);
      } finally {
        await endpoint.close();
      }
    });

    test('rejects a proxy address with no protocol at all', async () => {
      await expect(sendTelemetry({ endpoint: 'https://example.com/m', body: BODY, proxyUrl: ':::not a url', timeoutMs: 500 }))
        .rejects.toThrow(/Invalid proxy address/);
    });

    test.each([
      ['a missing endpoint', {}],
      ['an empty endpoint', { endpoint: '' }],
      ['a malformed endpoint', { endpoint: 'not-a-url' }],
    ])('rejects %s', async (_name, cfg) => {
      await expect(sendTelemetry(cfg as any)).rejects.toThrow();
    });

    test('rejects garbage input rather than reporting a phantom send', async () => {
      await expect(failure(sendTelemetry(undefined as any))).resolves.toContain('NoEndpoint');
      await expect(failure(sendTelemetry(null as any))).resolves.toContain('NoEndpoint');
    });
  });

  describe('certificate identity', () => {
    // Trusting the signer is not enough -- the certificate also has to cover the host we asked for.
    test('rejects a hostname mismatch on the direct path', async () => {
      const wrongCa = generateTestCa({ subjectAltName: 'DNS:not-the-endpoint.example.com' });
      const endpoint = await startEndpoint(wrongCa);
      try {
        await expect(failure(sendTelemetry({ endpoint: endpoint.url, body: BODY, caBundlePath: wrongCa.caCertPath, timeoutMs: 5000 })))
          .resolves.toContain('ERR_TLS_CERT_ALTNAME_INVALID');

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
        await expect(failure(sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          caBundlePath: wrongCa.caCertPath,
          timeoutMs: 5000,
        }))).resolves.toContain('ERR_TLS_CERT_ALTNAME_INVALID');

        // The tunnel opened, but the handshake to the endpoint must not have.
        expect(proxy.connects).toHaveLength(1);
        expect(endpoint.received).toHaveLength(0);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });

    test('rejects an IP-literal endpoint whose certificate omits that IP, through a proxy', async () => {
      // The certificate covers DNS:localhost but NOT IP:127.0.0.1, and the proxy is reached as an IP
      // too -- so if identity were checked against the proxy's host instead of the destination, this
      // would be wrongly accepted.
      const localhostOnlyCa = generateTestCa({ subjectAltName: 'DNS:localhost' });
      const endpoint = await startEndpoint(localhostOnlyCa, { urlHost: '127.0.0.1' });
      const proxy = await startConnectProxy();
      try {
        await expect(failure(sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          caBundlePath: localhostOnlyCa.caCertPath,
          timeoutMs: 5000,
        }))).resolves.toContain('ERR_TLS_CERT_ALTNAME_INVALID');

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
        await expect(sendTelemetry({
          endpoint: endpoint.url,
          body: BODY,
          proxyUrl: proxy.url,
          caBundlePath: ca.caCertPath,
          timeoutMs: 5000,
        })).resolves.toBe(200);

        expect(JSON.parse(endpoint.received[0].body)).toEqual(BODY);
      } finally {
        await proxy.close();
        await endpoint.close();
      }
    });
  });
});
