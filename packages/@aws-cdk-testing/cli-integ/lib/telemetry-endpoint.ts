import { promises as fs } from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as mockttp from 'mockttp';

/**
 * A local stand-in for the telemetry endpoint.
 *
 * Built on the same mockttp machinery as `startProxyServer`, which matters for one specific reason:
 * mockttp mints a leaf certificate for the requested host signed by the CA we hand it, so the CLI
 * can be pointed at `caBundlePath` with `--ca-bundle-path` and the delivery will actually complete a
 * TLS handshake. A bare self-signed certificate would fail hostname verification instead.
 *
 * Dispose it in a `finally` block.
 */
export interface TelemetryEndpoint {
  /**
   * URL to point `TELEMETRY_ENDPOINT` at.
   */
  readonly url: string;

  /**
   * Path to the CA certificate that signs this endpoint's certificate.
   *
   * Pass to `--ca-bundle-path` (or `AWS_CA_BUNDLE`) so the CLI, and the detached sender it spawns,
   * will trust it.
   */
  readonly caBundlePath: string;

  /**
   * Every telemetry batch this endpoint has received so far.
   */
  batches(): Promise<TelemetryBatch[]>;

  /**
   * Wait for at least one batch to arrive.
   *
   * Delivery happens in a detached child that outlives the CLI, so tests have to poll rather than
   * assert immediately after the command returns.
   *
   * @returns the first batch, or undefined if none arrived in time
   */
  waitForBatch(timeoutMs?: number): Promise<TelemetryBatch | undefined>;

  dispose(): Promise<void>;
}

/**
 * A batch of events as the endpoint received it.
 */
export interface TelemetryBatch {
  readonly events: Array<Record<string, any>>;
}

/**
 * Options for `startTelemetryEndpoint`.
 */
export interface TelemetryEndpointOptions {
  /**
   * Status code to answer with.
   *
   * @default 200
   */
  readonly statusCode?: number;

  /**
   * Where to put the generated certificate directory.
   *
   * @default the OS temp directory
   */
  readonly certDirRoot?: string;
}

export async function startTelemetryEndpoint(options: TelemetryEndpointOptions = {}): Promise<TelemetryEndpoint> {
  const certDir = await fs.mkdtemp(path.join(options.certDirRoot ?? os.tmpdir(), 'cdk-telemetry-'));
  const certPath = path.join(certDir, 'cert.pem');
  const keyPath = path.join(certDir, 'key.pem');

  const { key, cert } = await mockttp.generateCACertificate();
  await fs.writeFile(keyPath, key);
  await fs.writeFile(certPath, cert);

  const server = mockttp.getLocal({ https: { keyPath, certPath } });
  const endpoint = await server.forPost('/metrics').thenReply(
    options.statusCode ?? 200,
    JSON.stringify({ ok: true }),
    { 'content-type': 'application/json' },
  );

  // No port argument: mockttp picks a free one itself. Naming a port -- even a random one out of a
  // range -- collides once suites run in parallel, and there is no retry to recover from it.
  await server.start();

  const batches = async (): Promise<TelemetryBatch[]> => {
    const requests = await endpoint.getSeenRequests();
    return requests.map((req) => JSON.parse(req.body.buffer.toString('utf-8')) as TelemetryBatch);
  };

  return {
    // `localhost` rather than 127.0.0.1: the certificate mockttp mints covers the hostname, and this
    // is the name the sender will verify against.
    url: `https://localhost:${server.port}/metrics`,
    caBundlePath: certPath,
    batches,
    waitForBatch: (timeoutMs = 30_000) => waitFor(async () => (await batches())[0], timeoutMs),
    async dispose() {
      await server.stop();
      await fs.rm(certDir, { recursive: true, force: true });
    },
  };
}

/**
 * A TCP listener that accepts connections and then never answers.
 *
 * Stands in for an endpoint that hangs, which is how we tell "the CLI did not wait for delivery"
 * apart from "delivery happened to be fast".
 *
 * Dispose it in a `finally` block.
 */
export interface BlackHoleEndpoint {
  /**
   * URL to point `TELEMETRY_ENDPOINT` at.
   */
  readonly url: string;

  /**
   * How many connections have been accepted.
   *
   * A non-zero count is what proves delivery was actually attempted rather than skipped.
   */
  connectionCount(): number;

  /**
   * Wait for at least one connection to arrive.
   */
  waitForConnection(timeoutMs?: number): Promise<boolean>;

  dispose(): Promise<void>;
}

export async function startBlackHoleEndpoint(): Promise<BlackHoleEndpoint> {
  const sockets: net.Socket[] = [];
  let connections = 0;

  const server = net.createServer((socket) => {
    connections += 1;
    sockets.push(socket);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as net.AddressInfo).port;

  return {
    url: `https://127.0.0.1:${port}/metrics`,
    connectionCount: () => connections,
    waitForConnection: (timeoutMs = 30_000) => waitFor(async () => connections > 0 || undefined, timeoutMs).then((x) => x === true),
    async dispose() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

/**
 * Poll `fn` until it returns something truthy, or give up after `timeoutMs`.
 */
export async function waitFor<A>(fn: () => Promise<A | undefined>, timeoutMs: number): Promise<A | undefined> {
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
