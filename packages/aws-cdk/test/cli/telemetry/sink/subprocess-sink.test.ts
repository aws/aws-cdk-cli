import { spawn } from 'node:child_process';
import type * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as https from 'node:https';
import type * as net from 'node:net';
import { createServer } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { cleanupTestCas, generateTestCa, type TestCa } from '../test-tls';
import { createTestEvent } from './util';
import { CliIoHost } from '../../../../lib/cli/io-host';
import { cliRootDir } from '../../../../lib/cli/root-dir';
import { DISPATCHED_TRACE, SubprocessTelemetrySink } from '../../../../lib/cli/telemetry/sink/subprocess-sink';

// The sink hands the payload to a detached child process rather than making the request itself, so
// this is the boundary to observe. Only `spawn` is replaced -- the rest of the module is still needed
// (the TLS helper shells out to openssl), and the child is exercised for real further down.
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawn: jest.fn(),
}));

const ENDPOINT = 'https://example.com/telemetry';

interface FakeChild {
  /**
   * `undefined` is how libuv reports a spawn it refused: no throw, no pid.
   */
  pid: number | undefined;
  on: jest.Mock;
  unref: jest.Mock;
}

let child: FakeChild;

/**
 * The handler the sink registered for the child's `error` event.
 *
 * Node reports a refused spawn there rather than by throwing, so this is the only way to drive that
 * path.
 */
function errorHandler(): (e: Error) => void {
  const registered = child.on.mock.calls.filter(([event]) => event === 'error');
  expect(registered).toHaveLength(1);
  return registered[0][1];
}

/**
 * The payload path the sink passed to the child on its most recent spawn, whether or not that spawn
 * succeeded. Unlike `dispatched()` this does not read the file, so it survives the failure paths.
 */
function spawnedPayloadPath(): string {
  const calls = (spawn as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1][1];
}

/**
 * The payload file path the sink passed to the child on its most recent dispatch, and the config it
 * wrote there.
 */
function dispatched(): { senderPath: string; payloadPath: string; config: any } {
  const calls = (spawn as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [, args] = calls[calls.length - 1];
  const [senderPath, payloadPath] = args;
  return { senderPath, payloadPath, config: JSON.parse(fs.readFileSync(payloadPath, 'utf-8')) };
}

describe('SubprocessTelemetrySink', () => {
  let ioHost: CliIoHost;
  let traces: string[];
  const written: string[] = [];

  beforeAll(() => {
    // The sink only dispatches if it can find the compiled entry point next to the package root.
    const compiled = path.join(cliRootDir(), 'lib', 'cli', 'telemetry', 'sender-bundle.js');
    if (!fs.existsSync(compiled)) {
      throw new Error(`Expected the compiled telemetry sender at ${compiled}. Run \`npx projen compile\` before these tests.`);
    }
  });

  beforeEach(() => {
    child = { pid: 4242, on: jest.fn(), unref: jest.fn() };
    (spawn as jest.Mock).mockReturnValue(child);

    ioHost = CliIoHost.instance({ logLevel: 'trace' }, true);
    traces = [];
    jest.spyOn(ioHost, 'notify').mockImplementation(async (msg) => {
      traces.push(msg.message);
    });
  });

  afterEach(() => {
    for (const file of written.splice(0)) {
      fs.rmSync(file, { force: true });
    }
  });

  afterAll(() => cleanupTestCas());

  function sink(props: Partial<ConstructorParameters<typeof SubprocessTelemetrySink>[0]> = {}) {
    return new SubprocessTelemetrySink({ ioHost, endpoint: ENDPOINT, ...props });
  }

  describe('hand-off', () => {
    test('does not spawn anything at construction time', () => {
      sink();

      expect(spawn as jest.Mock).not.toHaveBeenCalled();
    });

    test('does not spawn when there are no events', async () => {
      await sink().flush();

      expect(spawn as jest.Mock).not.toHaveBeenCalled();
    });

    test('writes the payload to a file and passes its path to the bundled sender', async () => {
      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      const { senderPath, payloadPath, config } = dispatched();
      written.push(payloadPath);

      expect(senderPath).toBe(path.join(cliRootDir(), 'lib', 'cli', 'telemetry', 'sender-bundle.js'));
      expect(payloadPath.startsWith(os.tmpdir())).toBe(true);
      expect(config.endpoint).toBe(ENDPOINT);
      expect(config.body.events).toHaveLength(1);
    });

    test('runs the sender out of this process', async () => {
      // Everything else about the spawn -- detached, unref, discarded stdio -- is only meaningful as
      // observable behaviour, which `exits while delivery is still in flight` covers for real.
      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      const [command] = (spawn as jest.Mock).mock.calls[0];
      written.push((spawn as jest.Mock).mock.calls[0][1][1]);

      expect(command).toBe(process.execPath);
    });

    test('batches multiple events into a single sender', async () => {
      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      const { payloadPath, config } = dispatched();
      written.push(payloadPath);

      expect(config.body.events).toHaveLength(2);
    });

    test('a successful hand-off clears the events cache', async () => {
      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();
      written.push((spawn as jest.Mock).mock.calls[0][1][1]);

      await client.flush();

      expect(spawn as jest.Mock).toHaveBeenCalledTimes(1);
    });

    test('reports the hand-off on the trace channel', async () => {
      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();
      written.push((spawn as jest.Mock).mock.calls[0][1][1]);

      expect(traces.some((t) => t.includes(DISPATCHED_TRACE) && t.includes('pid 4242'))).toBe(true);
    });

    test('dispatches without first probing the network', async () => {
      // Any connectivity check would itself be a network call on the CLI's exit path, which is the
      // thing this sink exists to avoid.
      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();
      written.push((spawn as jest.Mock).mock.calls[0][1][1]);

      expect(traces.some((t) => t.includes('connectivity'))).toBe(false);
    });
  });

  describe('network configuration', () => {
    test('forwards the CA bundle PATH, never its contents', async () => {
      // The invariant: what crosses the process boundary is a path, so the payload's size is
      // independent of the CA bundle's. A real system bundle is ~190KB, and inlining it would make
      // every batch carry that -- for a value the child can read off disk itself.
      const ca = generateTestCa();
      const client = sink({ caBundlePath: ca.caCertPath, proxyUrl: 'http://corp:8080' });
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      const { payloadPath, config } = dispatched();
      written.push(payloadPath);

      expect(config.caBundlePath).toBe(ca.caCertPath);
      expect(config.proxyUrl).toBe('http://corp:8080');

      const raw = fs.readFileSync(payloadPath, 'utf-8');
      expect(raw).not.toContain('BEGIN CERTIFICATE');
      expect(raw.length).toBeLessThan(4096);
    });

    test('omits proxy and CA settings when none were configured', async () => {
      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      const { payloadPath, config } = dispatched();
      written.push(payloadPath);

      expect(config.proxyUrl).toBeUndefined();
      expect(config.caBundlePath).toBeUndefined();
    });

    test('an explicitly empty proxy crosses the process boundary as an empty string, not as unset', async () => {
      // `--proxy ''` means "go direct, ignore the proxy environment variables". The child inherits
      // that environment, so if the empty string were collapsed to unset on the way out the child
      // would auto-detect a proxy the parent had been told not to use.
      const client = sink({ proxyUrl: '' });
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      const { payloadPath, config } = dispatched();
      written.push(payloadPath);

      expect(config.proxyUrl).toBe('');
      expect(Object.keys(config)).toContain('proxyUrl');
    });
  });

  describe('payload size', () => {
    test('hands over a large batch whole, with no size ceiling', async () => {
      // The hand-off goes through a file precisely so that batch size is not bounded: a pipe would
      // block our own exit once the payload outgrew the OS buffer, which is the wait this sink
      // exists to avoid. 64KB is a typical pipe buffer, so exceeding it is the meaningful threshold.
      const client = sink();
      for (let i = 0; i < 400; i++) {
        await client.emit(createTestEvent('INVOKE'));
      }
      await client.flush();

      const { payloadPath, config } = dispatched();
      written.push(payloadPath);

      expect(fs.statSync(payloadPath).size).toBeGreaterThan(65_536);
      expect(config.body.events).toHaveLength(400);
      expect(traces.some((t) => t.includes('dropped'))).toBe(false);
    });
  });

  describe('failure handling', () => {
    test('a refused spawn is reported as a failure, not as a dispatch', async () => {
      // Node does NOT throw when it refuses a spawn (ENOENT, EACCES, EMFILE); it reports on the
      // child's `error` event, which fires after the hand-off has already returned. What it does do
      // synchronously is leave `pid` unset. Without a check for that, this path traced a successful
      // dispatch with `pid undefined` and the batch was silently counted as sent.
      child.pid = undefined;

      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.emit(createTestEvent('INVOKE'));
      await expect(client.flush()).resolves.toBeUndefined();

      expect(traces.some((t) => t.includes(DISPATCHED_TRACE))).toBe(false);
      expect(traces.some((t) => t.includes('Dropped 2 event(s)'))).toBe(true);
      expect(fs.existsSync(spawnedPayloadPath())).toBe(false);
    });

    test('a refused spawn does not retain the batch', async () => {
      // Delivery is one-shot: the process that would retry has usually exited by now, so retaining
      // the batch would only re-report the same failure and regrow it on the next interval.
      child.pid = undefined;

      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await expect(client.flush()).resolves.toBeUndefined();
      expect(traces.filter((t) => t.includes('Dropped'))).toHaveLength(1);

      child.pid = 4242;
      await client.flush();

      expect(spawn as jest.Mock).toHaveBeenCalledTimes(1);
    });

    test("the child's 'error' handler removes the payload file", async () => {
      // The residual case: the spawn was accepted synchronously but failed afterwards, by which time
      // the CLI may have exited. Nothing else runs, so if this handler does not clean up, every such
      // failure leaks a payload file into the temp directory.
      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      const payloadPath = spawnedPayloadPath();
      expect(fs.existsSync(payloadPath)).toBe(true);

      errorHandler()(new Error('EACCES: permission denied'));

      expect(fs.existsSync(payloadPath)).toBe(false);
    });

    test('a synchronous throw from spawn is handled too', async () => {
      // Defensive: the realistic refusals are asynchronous (see above), but argument validation can
      // still throw here, and it must not escape onto the CLI's exit path.
      (spawn as jest.Mock).mockImplementation(() => {
        throw new Error('EINVAL: invalid argument');
      });

      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await expect(client.flush()).resolves.toBeUndefined();

      expect(traces.filter((t) => t.includes('EINVAL'))).toHaveLength(1);
      expect(traces.some((t) => t.includes('Dropped 1 event(s)'))).toBe(true);
      expect(fs.existsSync(spawnedPayloadPath())).toBe(false);
    });

    test('logs once and drops the batch when the sender cannot be located', async () => {
      const client = sink({ resolveSender: () => undefined });
      await client.emit(createTestEvent('INVOKE'));

      await expect(client.flush()).resolves.toBeUndefined();

      expect(traces.filter((t) => t.includes('Unable to locate the telemetry sender'))).toHaveLength(1);
      expect(traces.some((t) => t.includes('Dropped 1 event(s)'))).toBe(true);
      expect(spawn as jest.Mock).not.toHaveBeenCalled();

      // Not retained: this never starts working mid-process, so retrying every 30s is pure noise.
      await client.flush();
      expect(traces.filter((t) => t.includes('Unable to locate the telemetry sender'))).toHaveLength(1);
    });

    test('rejects an endpoint with no host at construction', () => {
      expect(() => sink({ endpoint: 'file:///metrics' })).toThrow(/Telemetry Endpoint malformed/);
    });

    test('rejects an unparseable endpoint at construction', () => {
      expect(() => sink({ endpoint: 'not-a-url' })).toThrow(/Invalid URL/);
    });
  });

  describe('debug channel', () => {
    test('passes the child stderr through when CDK_TELEMETRY_SENDER_DEBUG=1', async () => {
      // Otherwise the sender's own traces go to a discarded fd and the one field-debug tool is
      // unusable.
      process.env.CDK_TELEMETRY_SENDER_DEBUG = '1';
      try {
        const client = sink();
        await client.emit(createTestEvent('INVOKE'));
        await client.flush();

        const [, , options] = (spawn as jest.Mock).mock.calls[0];
        written.push((spawn as jest.Mock).mock.calls[0][1][1]);

        expect(options.stdio).toEqual(['ignore', 'ignore', 'inherit']);
      } finally {
        delete process.env.CDK_TELEMETRY_SENDER_DEBUG;
      }
    });

    test('discards the child stdio by default', async () => {
      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      const [, , options] = (spawn as jest.Mock).mock.calls[0];
      written.push((spawn as jest.Mock).mock.calls[0][1][1]);

      expect(options.stdio).toBe('ignore');
    });
  });
});

/**
 * End-to-end coverage of the entry point itself.
 *
 * The tests above stop at the process boundary. These run the real `sender-bundle` in a real child
 * process against a real HTTPS server, which is the only way to know that the file hand-off,
 * cleanup and delivery actually work together.
 */
describe('sender-bundle entry point', () => {
  let ca: TestCa;
  let cdkHome: string;

  beforeAll(() => {
    ca = generateTestCa();
  });

  beforeEach(() => {
    // The child inherits CDK_HOME; point it somewhere disposable so nothing touches the developer's
    // real cache.
    cdkHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-home-'));
  });

  afterEach(() => {
    fs.rmSync(cdkHome, { recursive: true, force: true });
  });

  afterAll(() => cleanupTestCas());

  async function startEndpoint(options: { statusCode?: number } = {}): Promise<{ url: string; received: string[]; close(): Promise<void> }> {
    const received: string[] = [];
    const sockets: Array<{ destroy(): void }> = [];
    const server = https.createServer({ key: ca.serverKey, cert: ca.serverCert }, (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push(body);
        res.writeHead(options.statusCode ?? 200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    server.on('connection', (socket) => sockets.push(socket));
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const port = (server.address() as net.AddressInfo).port;
    return {
      // Connect by IP, matching the bind address. Nothing here asserts on the hostname, and resolving
      // `localhost` to ::1 first -- which Node 18+ does on a dual-stack box -- would ECONNREFUSED
      // against a listener bound only to 127.0.0.1. Covered by the certificate's `IP:127.0.0.1` SAN.
      url: `https://127.0.0.1:${port}/metrics`,
      received,
      close: () => new Promise<void>((ok) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => ok());
      }),
    };
  }

  /**
   * Run the entry point from source, so this does not depend on a prior build.
   */
  function runSender(payloadPath: string): Promise<number | null> {
    const { spawn: realSpawn } = jest.requireActual('node:child_process') as typeof childProcess;
    const tsx = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');
    const entryPoint = path.join(cliRootDir(), 'lib', 'cli', 'telemetry', 'sender-bundle.ts');

    return new Promise((ok, ko) => {
      const proc = realSpawn(process.execPath, [tsx, entryPoint, payloadPath], {
        stdio: 'ignore',
        env: { ...process.env, CDK_HOME: cdkHome },
      });
      proc.on('error', ko);
      proc.on('exit', (code) => ok(code));
    });
  }

  function writePayload(config: unknown): string {
    const payloadPath = path.join(os.tmpdir(), `cdk-telemetry-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(payloadPath, JSON.stringify(config));
    return payloadPath;
  }

  test('reads the payload file, delivers it, deletes the file, and exits 0', async () => {
    const endpoint = await startEndpoint();
    const body = { events: [{ identifiers: { sessionId: 'e2e-session' } }] };
    const payloadPath = writePayload({
      endpoint: endpoint.url,
      body,
      caBundlePath: ca.caCertPath,
      timeoutMs: 10_000,
    });

    try {
      const exitCode = await runSender(payloadPath);

      expect(exitCode).toBe(0);
      expect(endpoint.received).toHaveLength(1);
      expect(JSON.parse(endpoint.received[0])).toEqual(body);
      // The child owns the file; nothing else would ever collect it.
      expect(fs.existsSync(payloadPath)).toBe(false);
    } finally {
      fs.rmSync(payloadPath, { force: true });
      await endpoint.close();
    }
  }, 60_000);

  test('reads the CA bundle from the path it was given', async () => {
    // Proves the path really is enough: the endpoint's certificate is not publicly trusted, so
    // delivery only succeeds if the child loaded the bundle off disk itself.
    const endpoint = await startEndpoint();
    const withCa = writePayload({ endpoint: endpoint.url, body: { events: [{ n: 1 }] }, caBundlePath: ca.caCertPath, timeoutMs: 10_000 });
    const withoutCa = writePayload({ endpoint: endpoint.url, body: { events: [{ n: 2 }] }, timeoutMs: 10_000 });

    try {
      await expect(runSender(withoutCa)).resolves.toBe(0);
      expect(endpoint.received).toHaveLength(0);

      await expect(runSender(withCa)).resolves.toBe(0);
      expect(endpoint.received).toHaveLength(1);
    } finally {
      fs.rmSync(withCa, { force: true });
      fs.rmSync(withoutCa, { force: true });
      await endpoint.close();
    }
  }, 60_000);

  test('exits cleanly and removes the file when the payload is unusable', async () => {
    const payloadPath = path.join(os.tmpdir(), `cdk-telemetry-e2e-bad-${Date.now()}.json`);
    fs.writeFileSync(payloadPath, 'not json at all');

    try {
      await expect(runSender(payloadPath)).resolves.toBe(0);
      expect(fs.existsSync(payloadPath)).toBe(false);
    } finally {
      fs.rmSync(payloadPath, { force: true });
    }
  }, 60_000);

  test('exits cleanly when the payload file is missing entirely', async () => {
    const missing = path.join(os.tmpdir(), `cdk-telemetry-e2e-missing-${Date.now()}.json`);

    await expect(runSender(missing)).resolves.toBe(0);
  }, 60_000);

  describe('a failed delivery is not a failed CLI', () => {
    // Nobody waits on this process, but its exit status is still visible to anything watching the
    // process tree, and the payload file is nobody else's to collect. Both must hold on the failure
    // paths too, or a rejected send starts looking like a crash and leaks a file per invocation.
    test('a non-2xx response still exits 0 and removes the payload file', async () => {
      const endpoint = await startEndpoint({ statusCode: 500 });
      const payloadPath = writePayload({ endpoint: endpoint.url, body: { events: [{ n: 1 }] }, caBundlePath: ca.caCertPath, timeoutMs: 10_000 });

      try {
        await expect(runSender(payloadPath)).resolves.toBe(0);
        expect(endpoint.received).toHaveLength(1);
        expect(fs.existsSync(payloadPath)).toBe(false);
      } finally {
        fs.rmSync(payloadPath, { force: true });
        await endpoint.close();
      }
    }, 60_000);

    test('a transport failure still exits 0 and removes the payload file', async () => {
      // Port 1 is reserved and nothing listens on it.
      const payloadPath = writePayload({ endpoint: 'https://127.0.0.1:1/metrics', body: { events: [{ n: 1 }] }, timeoutMs: 5000 });

      try {
        await expect(runSender(payloadPath)).resolves.toBe(0);
        expect(fs.existsSync(payloadPath)).toBe(false);
      } finally {
        fs.rmSync(payloadPath, { force: true });
      }
    }, 60_000);
  });

  test('delivers with a CA bundle much larger than the payload itself', async () => {
    // The invariant that lets this work: the payload carries the bundle's PATH, so the child reads a
    // ~190KB system bundle (a concatenation of a few hundred certificates) off disk itself and the
    // payload stays small. Inlining the certificate would tie every batch's size to the CA bundle's.
    const endpoint = await startEndpoint();
    const bundlePath = path.join(cdkHome, 'big-bundle.pem');

    const single = fs.readFileSync(ca.caCertPath, 'utf-8');
    let bundle = '';
    while (Buffer.byteLength(bundle) < 128 * 1024) {
      bundle += single;
    }
    fs.writeFileSync(bundlePath, bundle);
    expect(fs.statSync(bundlePath).size).toBeGreaterThan(65_536);

    const payloadPath = writePayload({
      endpoint: endpoint.url,
      body: { events: [{ identifiers: { sessionId: 'big-bundle' } }] },
      caBundlePath: bundlePath,
      timeoutMs: 10_000,
    });

    // The invariant itself: a 128KB bundle leaves the payload tiny, because only the path travels.
    const payloadSize = fs.statSync(payloadPath).size;
    expect(payloadSize).toBeLessThan(4096);
    expect(fs.readFileSync(payloadPath, 'utf-8')).not.toContain('BEGIN CERTIFICATE');

    try {
      await expect(runSender(payloadPath)).resolves.toBe(0);

      expect(endpoint.received).toHaveLength(1);
      expect(JSON.parse(endpoint.received[0])).toEqual({ events: [{ identifiers: { sessionId: 'big-bundle' } }] });
    } finally {
      fs.rmSync(payloadPath, { force: true });
      await endpoint.close();
    }
  }, 60_000);
});

/**
 * The property the whole change exists for: the CLI is gone before delivery finishes.
 *
 * Cannot be observed from inside the process doing the work, so this runs a driver in a child
 * process, points it at an endpoint that accepts the connection and then never answers, and checks
 * that the driver exited while the sender it spawned was still running.
 */
describe('exits while delivery is still in flight', () => {
  test('the sink does not hold the process open until delivery finishes', async () => {
    const { spawn: realSpawn } = jest.requireActual('node:child_process') as typeof childProcess;

    // Accepts the TCP connection and then never writes a byte, so the sender hangs on it until its
    // own timeout. That is the window in which the driver has to have exited.
    const held: Array<{ destroy(): void }> = [];
    const blackHole = createServer((socket) => held.push(socket));
    await new Promise<void>((ok) => blackHole.listen(0, '127.0.0.1', ok));
    const port = (blackHole.address() as net.AddressInfo).port;

    const tsx = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');
    const driver = path.join(cliRootDir(), 'test', 'cli', 'telemetry', 'sink', 'exit-while-in-flight.driver.ts');

    let senderPid: number | undefined;
    try {
      const output = await new Promise<string>((ok, ko) => {
        const proc = realSpawn(process.execPath, [tsx, driver, `https://127.0.0.1:${port}/metrics`], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        let stdout = '';
        proc.stdout!.on('data', (chunk) => (stdout += chunk));
        proc.on('error', ko);
        // Resolves only once the driver has actually exited.
        proc.on('exit', () => ok(stdout));
      });

      senderPid = Number(output.match(/pid (\d+)/)?.[1]);
      expect(senderPid).toBeGreaterThan(0);

      // The driver has exited. If the sender is still alive, delivery was still in flight when it
      // did -- which is the whole point of detaching it.
      expect(() => process.kill(senderPid!, 0)).not.toThrow();
    } finally {
      if (senderPid) {
        try {
          process.kill(senderPid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
      for (const socket of held) {
        socket.destroy();
      }
      await new Promise<void>((ok) => blackHole.close(() => ok()));
    }
  }, 60_000);
});
