import * as fs from 'node:fs';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';

/**
 * The detached telemetry sender.
 *
 * This module is executed in a short-lived, detached child process (see `bin/cdk`, which
 * dispatches here when `CDK_TELEMETRY_SENDER=1`). Its only job is to POST a telemetry payload
 * that it receives on stdin, and then exit.
 *
 * IMPORTANT: this file must only import Node built-ins.
 *
 * The published `aws-cdk` package has *zero* runtime dependencies -- everything is inlined into
 * the `lib/index.js` esbuild bundle, and every entry in `dependencies` is rewritten to
 * `devDependencies` at pack time. The individually compiled `lib/**\/*.js` files are still shipped,
 * but any of them that reaches for an external module (or for a relative module that transitively
 * does) will fail with `Cannot find module` when required. Since `bin/cdk` requires this file
 * directly -- deliberately *not* going through the bundle, whose load costs ~600ms -- it has to
 * stand on its own.
 *
 * For the same reason this module never throws: `ToolkitError` lives in `@aws-cdk/toolkit-lib`,
 * which is not reachable from here. Every failure is swallowed and reported through the return
 * value instead. Telemetry must never be able to affect the CLI or leave a lingering process.
 */

/**
 * Budget for each individual network step.
 *
 * Emphatically NOT the parent's old `REQUEST_ATTEMPT_TIMEOUT_MS` of 500ms. That number existed to
 * stop a synchronous POST from holding up the user's prompt; now that the send happens in a
 * detached process that nobody waits on, a tight budget buys the user nothing and costs us
 * telemetry. It was also applied to *each* step of a proxied send -- connect + CONNECT, then the
 * TLS handshake to the endpoint, then the response -- so proxied users had to complete two TLS
 * handshakes inside 500ms each and were silently dropped when they could not. On a loaded CI runner
 * that is exactly what happened.
 *
 * The three steps are sequential, so the worst case is 3x this value; keep that comfortably under
 * `HARD_KILL_MS` so the ceiling stays a backstop against a genuinely stuck socket rather than
 * something that can fire during a slow-but-progressing handshake. 3s per step also matches what
 * the rest of the CLI already considers a reasonable background network budget (`NetworkDetector`
 * uses 3s in production).
 */
const NETWORK_TIMEOUT_MS = 3_000;

/**
 * Upper bound on the lifetime of this process.
 *
 * A hung read on stdin, or a TCP connection that neither completes nor errors, would otherwise
 * keep a detached process alive indefinitely after the CLI has exited. The timer is `unref`ed so
 * it never keeps the process alive by itself, but it still fires if something else does.
 *
 * Must exceed the worst-case send (3 x `NETWORK_TIMEOUT_MS`) plus reading stdin, which has no
 * timeout of its own. Nobody waits on this process -- its stdio is discarded and it is `unref`ed --
 * so a generous ceiling costs the user nothing.
 */
const HARD_KILL_MS = 20_000;

/**
 * Refuse to buffer an unreasonable amount of stdin.
 *
 * The parent applies its own (much smaller) limit; this is only a backstop.
 */
const MAX_STDIN_BYTES = 1_048_576;

/**
 * Give up if a proxy sends a pathologically large CONNECT response.
 */
const MAX_PROXY_RESPONSE_BYTES = 16_384;

/**
 * Proxy schemes we can tunnel through using only Node built-ins.
 *
 * `proxy-agent` (used by the CLI itself) additionally supports `socks*` and `pac+*`. Those
 * require a real SOCKS implementation and a PAC interpreter respectively, neither of which is
 * available here. When we see one we skip the send entirely rather than falling back to a direct
 * connection: a proxy is usually mandatory rather than advisory (corporate setups routinely
 * firewall direct egress), so bypassing it would be both futile and a policy violation.
 */
const SUPPORTED_PROXY_PROTOCOLS = ['http:', 'https:'];

/**
 * Default ports per scheme, matching `proxy-from-env@1`'s table.
 *
 * Used when matching `NO_PROXY` entries that carry an explicit port.
 */
const DEFAULT_PORTS: Record<string, number> = {
  ftp: 21,
  gopher: 70,
  http: 80,
  https: 443,
  ws: 80,
  wss: 443,
};

/**
 * What the parent process pipes to this process on stdin.
 */
export interface TelemetrySenderConfig {
  /**
   * Absolute URL to POST the telemetry payload to.
   */
  readonly endpoint: string;

  /**
   * The telemetry payload. Serialized as-is into the request body.
   */
  readonly body: unknown;

  /**
   * Proxy to tunnel through, if the user configured one explicitly.
   *
   * @default - resolved from the inherited proxy environment variables
   */
  readonly proxyUrl?: string;

  /**
   * Contents (not path) of a CA bundle to trust.
   *
   * Note that Node's `ca` option REPLACES the default trust set rather than adding to it, so when
   * this is present the bundled roots are no longer consulted. That is what we want for a
   * TLS-terminating corporate proxy, and it matches what the parent does with the same bytes.
   *
   * @default - the default Node trust store, plus anything in `NODE_EXTRA_CA_CERTS`
   */
  readonly ca?: string;

  /**
   * Overrides the inherited `NO_PROXY` environment variable.
   *
   * @default - the inherited `NO_PROXY`/`no_proxy`
   */
  readonly noProxy?: string;

  /**
   * Budget for each network step, in milliseconds.
   *
   * @default 3000
   */
  readonly timeoutMs?: number;
}

/**
 * Outcome of a send attempt. Purely informational -- nothing acts on it except tests and traces.
 */
export interface SendResult {
  /**
   * Whether the endpoint accepted the payload with a 2xx response.
   */
  readonly sent: boolean;

  /**
   * How the request was routed, or `skipped` if we never went on the network.
   */
  readonly via: 'direct' | 'connect-tunnel' | 'skipped';

  /**
   * HTTP status code, if we got a response at all.
   *
   * @default - no response was received
   */
  readonly statusCode?: number;

  /**
   * Why the send did not succeed.
   *
   * @default - the send succeeded
   */
  readonly reason?: string;
}

/**
 * Entry point invoked by `bin/cdk` when `CDK_TELEMETRY_SENDER=1`.
 *
 * Reads a `TelemetrySenderConfig` as JSON from stdin, attempts one delivery, and always exits 0.
 */
export function main(): void {
  const hardKill = setTimeout(() => process.exit(0), HARD_KILL_MS);
  hardKill.unref();

  const finish = () => {
    clearTimeout(hardKill);
    process.exit(0);
  };

  try {
    void readAll(process.stdin, MAX_STDIN_BYTES)
      .then((input) => (input === undefined ? undefined : deliver(input)))
      .then(finish, finish);
  } catch {
    finish();
  }
}

/**
 * Read a stream to completion as UTF-8, giving up if it exceeds `maxBytes`.
 *
 * Chunks are measured and joined as `Buffer`s rather than strings: a string's `length` counts
 * UTF-16 code units, so a cap applied to it would let a multi-byte payload through at up to three
 * times the intended size. Buffering the raw bytes and decoding once at the end also avoids having
 * to reason about multi-byte sequences that straddle a chunk boundary.
 *
 * Never rejects. Resolves `undefined` if the limit was exceeded or the stream errored, meaning
 * "there is nothing here worth sending".
 */
export function readAll(stream: NodeJS.ReadableStream, maxBytes: number): Promise<string | undefined> {
  return new Promise<string | undefined>((ok) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let overflowed = false;

    stream.on('data', (chunk: Buffer | string) => {
      if (overflowed) {
        return;
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buf.byteLength;
      if (bytes > maxBytes) {
        overflowed = true;
        chunks.length = 0;
        trace(`Input exceeded ${maxBytes} bytes, discarding`);
        return;
      }
      chunks.push(buf);
    });

    stream.on('error', () => ok(undefined));
    stream.on('end', () => ok(overflowed ? undefined : Buffer.concat(chunks).toString('utf-8')));
  });
}

/**
 * Parse a piped config and attempt delivery. Never rejects.
 */
async function deliver(input: string): Promise<SendResult> {
  const result = await parseAndSend(input);
  trace(result.sent
    ? `Telemetry sent (${result.via}, ${result.statusCode})`
    : `Telemetry not sent (${result.via}): ${result.reason}`);
  return result;
}

async function parseAndSend(input: string): Promise<SendResult> {
  let cfg: TelemetrySenderConfig;
  try {
    cfg = JSON.parse(input) as TelemetrySenderConfig;
  } catch (e: any) {
    return { sent: false, via: 'skipped', reason: `MalformedPayload: ${e?.message}` };
  }
  return sendTelemetry(cfg);
}

/**
 * Deliver a telemetry payload, tunnelling through a proxy when one applies.
 *
 * Never rejects and never throws: every failure is reported through the returned `SendResult`.
 */
export async function sendTelemetry(cfg: TelemetrySenderConfig, env: NodeJS.ProcessEnv = process.env): Promise<SendResult> {
  try {
    if (!cfg?.endpoint) {
      return { sent: false, via: 'skipped', reason: 'NoEndpoint' };
    }

    const url = new URL(cfg.endpoint);
    const timeoutMs = cfg.timeoutMs ?? NETWORK_TIMEOUT_MS;
    const payload = JSON.stringify(cfg.body ?? {});

    // `??`, not `||`: the parent forces its configured value whenever `--proxy` (or the `proxy`
    // setting) is present at all -- including as an empty string, which means "no proxy" -- and
    // never falls back to the environment in that case. Only auto-detect when nothing was
    // forwarded, so the child reaches the same decision the parent would.
    const proxyUrl = cfg.proxyUrl ?? resolveProxy(cfg.endpoint, proxyEnv(cfg, env));
    if (!proxyUrl) {
      return await postDirect(url, payload, cfg.ca, timeoutMs);
    }

    let proxy: URL;
    try {
      proxy = new URL(proxyUrl);
    } catch {
      return { sent: false, via: 'skipped', reason: `MalformedProxyUrl: ${proxyUrl}` };
    }

    if (!SUPPORTED_PROXY_PROTOCOLS.includes(proxy.protocol)) {
      // Fail closed. Do NOT retry directly -- see SUPPORTED_PROXY_PROTOCOLS.
      return { sent: false, via: 'skipped', reason: `UnsupportedProxyProtocol: ${proxy.protocol}` };
    }

    return await postViaProxy(url, proxy, payload, cfg.ca, timeoutMs);
  } catch (e: any) {
    return { sent: false, via: 'skipped', reason: `${e?.name ?? 'Error'}: ${e?.message}` };
  }
}

/**
 * Resolve the proxy to use for `endpoint` from proxy environment variables.
 *
 * Faithfully re-implements `proxy-from-env@1`, which is what `proxy-agent` falls back to in the
 * parent process when the user did not pass `--proxy`. Kept in lockstep by a differential test
 * (`test/cli/telemetry/resolve-proxy-parity.test.ts`) that runs both over the same table, so the
 * quirks below are deliberate rather than accidental:
 *
 * - `npm_config_*` variants take precedence over the plain ones;
 * - a `NO_PROXY` entry only does suffix matching if it starts with `.` or `*`, otherwise it must
 *   match the host exactly;
 * - IPv6 hosts keep their brackets.
 *
 * Returns the empty string when no proxy applies.
 */
export function resolveProxy(endpoint: string, env: NodeJS.ProcessEnv): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return '';
  }

  if (!parsed.host || !parsed.protocol) {
    return '';
  }

  const protocol = parsed.protocol.split(':', 1)[0];
  // Strip the port off `host` rather than using `hostname`, to keep the brackets around IPv6
  // addresses (which is what NO_PROXY entries are matched against).
  const host = parsed.host.replace(/:\d*$/, '');
  const port = parseInt(parsed.port, 10) || DEFAULT_PORTS[protocol] || 0;

  if (!shouldProxy(host, port, env)) {
    return '';
  }

  let proxy =
    getEnv(env, `npm_config_${protocol}_proxy`) ||
    getEnv(env, `${protocol}_proxy`) ||
    getEnv(env, 'npm_config_proxy') ||
    getEnv(env, 'all_proxy');

  if (proxy && !proxy.includes('://')) {
    // Missing scheme in proxy, default to the requested URL's scheme.
    proxy = `${protocol}://${proxy}`;
  }
  return proxy;
}

/**
 * Apply an explicit `noProxy` override on top of the inherited environment.
 */
function proxyEnv(cfg: TelemetrySenderConfig, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (cfg.noProxy === undefined) {
    return env;
  }
  return { ...env, NO_PROXY: cfg.noProxy, no_proxy: cfg.noProxy, npm_config_no_proxy: cfg.noProxy };
}

function getEnv(env: NodeJS.ProcessEnv, name: string): string {
  return env[name.toLowerCase()] || env[name.toUpperCase()] || '';
}

/**
 * `NO_PROXY` matching, following `proxy-from-env@1`.
 */
function shouldProxy(host: string, port: number, env: NodeJS.ProcessEnv): boolean {
  const noProxy = (getEnv(env, 'npm_config_no_proxy') || getEnv(env, 'no_proxy')).toLowerCase();
  if (!noProxy) {
    return true;
  }
  if (noProxy === '*') {
    return false;
  }

  return noProxy.split(/[,\s]/).every((entry) => {
    if (!entry) {
      return true;
    }

    const withPort = entry.match(/^(.+):(\d+)$/);
    let entryHost = withPort ? withPort[1] : entry;
    const entryPort = withPort ? parseInt(withPort[2], 10) : 0;
    if (entryPort && entryPort !== port) {
      return true;
    }

    if (!/^[.*]/.test(entryHost)) {
      // No wildcard, so this only stops proxying on an exact match.
      return host !== entryHost;
    }

    if (entryHost.charAt(0) === '*') {
      entryHost = entryHost.slice(1);
    }
    return !host.endsWith(entryHost);
  });
}

/**
 * POST straight to the endpoint. `node:https` applies `ca` natively.
 */
function postDirect(url: URL, payload: string, ca: string | undefined, timeoutMs: number): Promise<SendResult> {
  return new Promise<SendResult>((ok) => {
    let settled = false;
    const done = (result: SendResult) => {
      if (!settled) {
        settled = true;
        ok(result);
      }
    };

    const req = https.request({
      hostname: url.hostname,
      port: url.port || null,
      path: url.pathname,
      method: 'POST',
      headers: jsonHeaders(payload),
      ca,
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      done({ sent: isSuccess(res.statusCode), via: 'direct', statusCode: res.statusCode, reason: reasonFor(res.statusCode) });
    });

    req.on('error', (e: any) => done({ sent: false, via: 'direct', reason: `${e?.code ?? e?.name}: ${e?.message}` }));
    req.on('timeout', () => {
      req.destroy();
      done({ sent: false, via: 'direct', reason: `RequestTimeout after ${timeoutMs}ms` });
    });
    req.end(payload);
  });
}

/**
 * Tunnel to the endpoint with an HTTP CONNECT, then speak HTTPS over the tunnelled socket.
 *
 * This mirrors what `https-proxy-agent` does for the CLI's other network calls, minus the parts
 * we cannot support without external dependencies.
 */
async function postViaProxy(url: URL, proxy: URL, payload: string, ca: string | undefined, timeoutMs: number): Promise<SendResult> {
  const port = Number(url.port || 443);

  let tunnel: net.Socket;
  try {
    tunnel = await openTunnel(proxy, url.hostname, port, ca, timeoutMs);
  } catch (e: any) {
    return { sent: false, via: 'connect-tunnel', reason: `${e?.code ?? e?.name}: ${e?.message}` };
  }

  let secure: tls.TLSSocket;
  try {
    secure = await upgradeToTls(tunnel, url.hostname, ca, timeoutMs);
  } catch (e: any) {
    tunnel.destroy();
    return { sent: false, via: 'connect-tunnel', reason: `${e?.code ?? e?.name}: ${e?.message}` };
  }

  try {
    const statusCode = await postOverSocket(secure, hostHeader(url), url.pathname, payload, timeoutMs);
    return { sent: isSuccess(statusCode), via: 'connect-tunnel', statusCode, reason: reasonFor(statusCode) };
  } catch (e: any) {
    return { sent: false, via: 'connect-tunnel', reason: `${e?.code ?? e?.name}: ${e?.message}` };
  } finally {
    secure.destroy();
  }
}

/**
 * Open a CONNECT tunnel through `proxy` to `host:port` and hand back the raw socket.
 */
function openTunnel(proxy: URL, host: string, port: number, ca: string | undefined, timeoutMs: number): Promise<net.Socket> {
  return new Promise<net.Socket>((ok, ko) => {
    const proxyHost = (proxy.hostname || '').replace(/^\[|\]$/g, '');
    const proxyPort = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80));

    const socket = proxy.protocol === 'https:'
      ? tls.connect({ host: proxyHost, port: proxyPort, servername: sni(proxyHost), ca, ALPNProtocols: ['http/1.1'] })
      : net.connect({ host: proxyHost, port: proxyPort });

    const timer = setTimeout(() => fail(error('ProxyConnectTimeout', `No CONNECT response after ${timeoutMs}ms`)), timeoutMs);
    timer.unref();

    let buffered = Buffer.alloc(0);

    function cleanup() {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', fail);
      socket.removeListener('close', onClose);
    }

    function fail(e: Error) {
      cleanup();
      socket.destroy();
      ko(e);
    }

    function onClose() {
      fail(error('ProxyConnectionClosed', 'Proxy closed the connection before responding'));
    }

    function onData(chunk: Buffer) {
      buffered = Buffer.concat([buffered, chunk]);

      // Hard cap on what we will buffer before the tunnel is open. Checked unconditionally so it
      // still fires when a terminator arrives inside an otherwise oversized chunk. Nothing
      // legitimate can be large here: we have not sent a ClientHello yet, so there is no TLS
      // traffic to pipeline.
      if (buffered.length > MAX_PROXY_RESPONSE_BYTES) {
        fail(error('ProxyResponseTooLarge', 'Proxy sent an oversized CONNECT response'));
        return;
      }

      const headerEnd = buffered.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }

      const statusLine = buffered.subarray(0, buffered.indexOf('\r\n')).toString('latin1').trim();
      if (!isSuccess(Number(statusLine.split(' ')[1]))) {
        fail(error('ProxyConnectFailed', statusLine));
        return;
      }

      cleanup();

      // A proxy may deliver bytes belonging to the tunnel in the same chunk as its response. Put
      // them back so the TLS handshake that follows sees them, rather than dropping them. The
      // socket must be paused first: removing our listener does not stop it flowing, and
      // unshifting into a flowing stream silently discards the data.
      const trailing = buffered.subarray(headerEnd + 4);
      if (trailing.length > 0) {
        socket.pause();
        socket.unshift(trailing);
      }

      ok(socket);
    }

    socket.on('data', onData);
    socket.on('error', fail);
    socket.on('close', onClose);
    socket.once(proxy.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
      socket.write(connectRequest(proxy, host, port));
    });
  });
}

/**
 * Render the CONNECT request line and headers, including Basic proxy auth when credentials are
 * embedded in the proxy URL.
 */
function connectRequest(proxy: URL, host: string, port: number): string {
  const target = net.isIPv6(host) ? `[${host}]` : host;
  let out = `CONNECT ${target}:${port} HTTP/1.1\r\n`;
  out += `Host: ${target}:${port}\r\n`;
  out += 'Proxy-Connection: close\r\n';
  if (proxy.username || proxy.password) {
    const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
    out += `Proxy-Authorization: Basic ${Buffer.from(credentials).toString('base64')}\r\n`;
  }
  return `${out}\r\n`;
}

/**
 * Upgrade an established tunnel to TLS against the *endpoint* (not the proxy).
 *
 * `host` matters as much as `servername` here, and for a different reason: `servername` drives the
 * SNI extension (and is deliberately omitted for IP literals, which may not be sent as SNI), while
 * `host` is what Node's `checkServerIdentity` matches the certificate against. With neither set,
 * Node falls back to the underlying socket's host -- which on this path is the *proxy* -- so a
 * certificate valid for the proxy's name would be accepted for a connection intended for the
 * endpoint. Always pass the real destination.
 */
function upgradeToTls(socket: net.Socket, hostname: string, ca: string | undefined, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise<tls.TLSSocket>((ok, ko) => {
    const secure = tls.connect({ socket, host: hostname, servername: sni(hostname), ca, ALPNProtocols: ['http/1.1'] });
    const timer = setTimeout(() => {
      secure.destroy();
      ko(error('TlsHandshakeTimeout', `TLS handshake did not complete within ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();

    secure.once('secureConnect', () => {
      clearTimeout(timer);
      ok(secure);
    });
    secure.once('error', (e: Error) => {
      clearTimeout(timer);
      ko(e);
    });
  });
}

/**
 * Write a minimal HTTP/1.1 POST over an already-connected socket and read back the status code.
 *
 * We frame the request by hand because `http.request` cannot be pointed at a pre-existing
 * `TLSSocket` without an Agent, and Agents are what we are avoiding here.
 */
function postOverSocket(socket: tls.TLSSocket, host: string, path: string, payload: string, timeoutMs: number): Promise<number> {
  return new Promise<number>((ok, ko) => {
    const timer = setTimeout(() => ko(error('ResponseTimeout', `No response within ${timeoutMs}ms`)), timeoutMs);
    timer.unref();

    let response = '';
    const onData = (chunk: Buffer) => {
      response += chunk.toString('latin1');
      // Symmetric with the CONNECT response cap: bound what we accumulate so a server that never
      // terminates its headers cannot grow this without limit inside the timeout window.
      if (response.length > MAX_PROXY_RESPONSE_BYTES) {
        clearTimeout(timer);
        socket.removeListener('data', onData);
        ko(error('ResponseTooLarge', 'Endpoint sent an oversized response header'));
        return;
      }
      if (response.includes('\r\n\r\n')) {
        clearTimeout(timer);
        socket.removeListener('data', onData);
        ok(Number(response.split(' ')[1]));
      }
    };

    socket.on('data', onData);
    socket.once('error', (e: Error) => {
      clearTimeout(timer);
      ko(e);
    });

    const headers = [
      `POST ${path} HTTP/1.1`,
      `Host: ${host}`,
      'content-type: application/json',
      `content-length: ${Buffer.byteLength(payload)}`,
      'connection: close',
    ].join('\r\n');
    socket.write(`${headers}\r\n\r\n${payload}`);
  });
}

function jsonHeaders(payload: string): Record<string, string | number> {
  return {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  };
}

function hostHeader(url: URL): string {
  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
}

/**
 * TLS servername, omitted for IP literals (which must not be sent as SNI).
 */
function sni(host: string): string | undefined {
  return net.isIP(host) ? undefined : host;
}

function isSuccess(statusCode: number | undefined): boolean {
  return statusCode !== undefined && statusCode >= 200 && statusCode < 300;
}

function reasonFor(statusCode: number | undefined): string | undefined {
  return isSuccess(statusCode) ? undefined : `UnexpectedStatusCode: ${statusCode}`;
}

/**
 * Build (never throw) a named error.
 *
 * `ToolkitError` is unavailable here, and a bare `throw` is banned by lint, so failures travel as
 * rejections carrying one of these.
 */
function error(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

/**
 * Diagnostics for the detached child, which has no IoHost.
 *
 * stderr is `ignore`d by the parent, so this is only visible when the sender is run by hand with
 * `CDK_TELEMETRY_SENDER_DEBUG=1`. Written synchronously: `process.stderr` is asynchronous when it
 * is a pipe, and the `process.exit(0)` that follows would discard a buffered write.
 */
function trace(message: string): void {
  if (process.env.CDK_TELEMETRY_SENDER_DEBUG !== '1') {
    return;
  }
  try {
    fs.writeSync(2, `[cdk-telemetry-sender] ${message}\n`);
  } catch {
    // Diagnostics must never be the reason anything fails.
  }
}
