import { spawn } from 'node:child_process';
import type * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as https from 'node:https';
import type * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { cleanupTestCas, generateTestCa, type TestCa } from '../test-tls';
import { createTestEvent } from './util';
import { CliIoHost } from '../../../../lib/cli/io-host';
import { cliRootDir } from '../../../../lib/cli/root-dir';
import { SubprocessTelemetrySink } from '../../../../lib/cli/telemetry/sink/subprocess-sink';

// The sink hands the payload to a detached child process rather than making the request itself, so
// this is the boundary to observe. Only `spawn` is replaced -- the rest of the module is still needed
// (the TLS helper shells out to openssl), and the child is exercised for real further down.
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawn: jest.fn(),
}));

const ENDPOINT = 'https://example.com/telemetry';

interface FakeChild {
  pid: number;
  on: jest.Mock;
  unref: jest.Mock;
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
  let child: FakeChild;
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

    test('lets the child outlive us and does not wait on its stdio', async () => {
      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      const [command, , options] = (spawn as jest.Mock).mock.calls[0];
      written.push((spawn as jest.Mock).mock.calls[0][1][1]);

      expect(command).toBe(process.execPath);
      expect(options).toMatchObject({ detached: true, stdio: 'ignore', shell: false, cwd: os.tmpdir() });
      expect(child.unref).toHaveBeenCalled();
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

      expect(traces.some((t) => t.includes('Telemetry dispatched') && t.includes('pid 4242'))).toBe(true);
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
      // Regression: the sink used to inline the certificate itself. A real system bundle is ~190KB,
      // which blew past the old 64KB payload cap and silently dropped every batch for anybody using
      // a corporate proxy.
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
  });

  describe('payload size', () => {
    test('hands over a batch far larger than the old 64KB cap', async () => {
      // Regression: anything over 64KB used to be dropped outright, because it was written to the
      // child's stdin and would have blocked our own exit. A file has no such limit.
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
    test('swallows a spawn failure, traces it, and retains the events', async () => {
      (spawn as jest.Mock).mockImplementation(() => {
        throw new Error('EMFILE: too many open files');
      });

      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await expect(client.flush()).resolves.toBeUndefined();

      expect(traces.some((t) => t.includes('EMFILE'))).toBe(true);

      // Retained, so the next flush can try again.
      (spawn as jest.Mock).mockReturnValue(child);
      await client.flush();
      const { payloadPath, config } = dispatched();
      written.push(payloadPath);
      expect(config.body.events).toHaveLength(1);
    });

    test('does not leave the payload file behind when the spawn fails', async () => {
      const paths: string[] = [];
      (spawn as jest.Mock).mockImplementation((_cmd: string, args: string[]) => {
        paths.push(args[1]);
        throw new Error('ENOENT');
      });

      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      expect(paths).toHaveLength(1);
      expect(fs.existsSync(paths[0])).toBe(false);
    });

    test('rejects an endpoint with no host at construction', () => {
      expect(() => sink({ endpoint: 'file:///metrics' })).toThrow(/Telemetry Endpoint malformed/);
    });

    test('rejects an unparseable endpoint at construction', () => {
      expect(() => sink({ endpoint: 'not-a-url' })).toThrow(/Invalid URL/);
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

  beforeAll(() => {
    ca = generateTestCa();
  });

  afterAll(() => cleanupTestCas());

  async function startEndpoint(): Promise<{ url: string; received: string[]; close(): Promise<void> }> {
    const received: string[] = [];
    const sockets: Array<{ destroy(): void }> = [];
    const server = https.createServer({ key: ca.serverKey, cert: ca.serverCert }, (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    server.on('connection', (socket) => sockets.push(socket));
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const port = (server.address() as net.AddressInfo).port;
    return {
      url: `https://localhost:${port}/metrics`,
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
      const proc = realSpawn(process.execPath, [tsx, entryPoint, payloadPath], { stdio: 'ignore' });
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
});
