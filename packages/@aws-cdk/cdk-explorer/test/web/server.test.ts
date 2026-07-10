import type { AcquireAssemblyLock } from '../../lib/core/assembly-lock';
import type { SynthRunResult } from '../../lib/core/synth-runner';
import { ASSEMBLY_CHANGED } from '../../lib/web/protocol';
import { startWebServer, DEFAULT_PORT, type WebServer, type WebServerOptions } from '../../lib/web/server';
import type { SourceWatcher, SourceWatcherOptions } from '../../lib/web/source-watcher';

const noopSynth: (dir: string) => Promise<SynthRunResult> = async () => ({ status: 'success' });
const noopStartSourceWatcher = (_opts: SourceWatcherOptions): SourceWatcher => ({
  async close() {
  },
});
const noopAcquireAssemblyLock: AcquireAssemblyLock = async () => ({
  release: async () => {
  },
});

function startTestServer(overrides: Partial<WebServerOptions> = {}): Promise<WebServer> {
  return startWebServer({
    synthRunner: noopSynth,
    startSourceWatcher: noopStartSourceWatcher,
    acquireAssemblyLock: noopAcquireAssemblyLock,
    ...overrides,
  });
}

describe('Web Server', () => {
  let server: WebServer;

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  test('starts and responds to health check', async () => {
    server = await startTestServer();

    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  test('binds to localhost by default', async () => {
    server = await startTestServer();
    expect(server.url).toMatch(/^http:\/\/localhost:\d+$/);
  });

  test('auto-increments port by 1 when default is taken', async () => {
    const first = await startTestServer({ port: DEFAULT_PORT });
    server = await startTestServer();

    expect(first.url).toBe(`http://localhost:${DEFAULT_PORT}`);
    expect(server.url).toBe(`http://localhost:${DEFAULT_PORT + 1}`);
    await first.stop();
  });

  test('throws when explicit port is taken', async () => {
    const first = await startTestServer({ port: 4567 });
    try {
      await expect(startTestServer({ port: 4567 })).rejects.toThrow();
    } finally {
      await first.stop();
    }
  });

  test('stops cleanly', async () => {
    server = await startTestServer();
    const url = server.url;

    await server.stop();

    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  });

  test('stop is idempotent', async () => {
    server = await startTestServer();
    await server.stop();
    await server.stop();
  });

  test('unknown /api route returns a JSON 404 rather than the SPA', async () => {
    server = await startTestServer();
    const res = await fetch(`${server.url}/api/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect((await res.json()).error).toBeDefined();
  });

  test('serves the SPA index with Cache-Control: no-store so a rebuilt bundle is not served stale', async () => {
    server = await startTestServer();
    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('watches the resolved assembly dir and closes the watcher on stop', async () => {
    let seenDir: string | undefined;
    let closed = false;
    server = await startTestServer({
      assemblyDir: '/tmp/explorer-test/cdk.out',
      startAssemblyWatcher: (opts) => {
        seenDir = opts.assemblyDir;
        return {
          close: async () => {
            closed = true;
          },
        };
      },
    });

    expect(seenDir).toBe('/tmp/explorer-test/cdk.out');

    await server.stop();
    expect(closed).toBe(true);
  });

  test('broadcasts an assembly-changed event to a connected client when the watcher fires', async () => {
    let fireChange = (): void => undefined;
    server = await startTestServer({
      startAssemblyWatcher: (opts) => {
        fireChange = opts.onChange;
        return { close: async () => undefined };
      },
    });

    const res = await fetch(`${server.url}/api/events`);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();

    fireChange();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain(`event: ${ASSEMBLY_CHANGED}`);

    await reader.cancel();
  });
});

describe('Web Server — auto-synth', () => {
  let server: WebServer;
  let mockSynthRunner: jest.Mock<Promise<SynthRunResult>, [string]>;
  let capturedOnChange: () => void;
  let fakeWatcherClosed: boolean;

  function fakeStartSourceWatcher(opts: SourceWatcherOptions): SourceWatcher {
    capturedOnChange = opts.onChange;
    fakeWatcherClosed = false;
    return {
      async close() {
        fakeWatcherClosed = true;
      },
    };
  }

  beforeEach(async () => {
    mockSynthRunner = jest.fn<Promise<SynthRunResult>, [string]>().mockResolvedValue({ status: 'success' });
    server = await startTestServer({
      synthRunner: mockSynthRunner,
      startSourceWatcher: fakeStartSourceWatcher,
    });
  });

  afterEach(async () => {
    await server.stop();
  });

  test('auto-synth is off by default', () => {
    expect(server.autoSynthEnabled).toBe(false);
  });

  test('source change with auto-synth OFF does not trigger synth', async () => {
    capturedOnChange();
    await tick();
    expect(mockSynthRunner).not.toHaveBeenCalled();
  });

  test('source change with auto-synth ON triggers synth', async () => {
    await fetch(`${server.url}/api/synth/auto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    capturedOnChange();
    await tick();
    expect(mockSynthRunner).toHaveBeenCalledTimes(1);
  });

  test('toggle via API controls auto-synth behavior', async () => {
    await fetch(`${server.url}/api/synth/auto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    capturedOnChange();
    await tick();
    expect(mockSynthRunner).toHaveBeenCalledTimes(1);
  });

  test('POST /api/synth triggers a manual synth', async () => {
    const res = await fetch(`${server.url}/api/synth`, { method: 'POST' });
    const body = await res.json();
    expect(body).toEqual({ status: 'success' });
    expect(mockSynthRunner).toHaveBeenCalledTimes(1);
  });

  test('stop closes the source watcher', async () => {
    await server.stop();
    expect(fakeWatcherClosed).toBe(true);
  });
});

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
