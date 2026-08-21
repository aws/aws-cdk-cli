import { ASSEMBLY_CHANGED, SOURCE_CHANGED } from '../../lib/web/protocol';
import { startWebServer, DEFAULT_PORT, type WebServer } from '../../lib/web/server';

describe('Web Server', () => {
  let server: WebServer;

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  test('starts and responds to health check', async () => {
    server = await startWebServer();

    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  test('binds to localhost by default', async () => {
    server = await startWebServer();
    expect(server.url).toMatch(/^http:\/\/localhost:\d+$/);
  });

  test('auto-increments port by 1 when default is taken', async () => {
    const first = await startWebServer({ port: DEFAULT_PORT });
    server = await startWebServer();

    expect(first.url).toBe(`http://localhost:${DEFAULT_PORT}`);
    expect(server.url).toBe(`http://localhost:${DEFAULT_PORT + 1}`);
    await first.stop();
  });

  test('throws when explicit port is taken', async () => {
    const first = await startWebServer({ port: 4567 });
    try {
      await expect(startWebServer({ port: 4567 })).rejects.toThrow();
    } finally {
      await first.stop();
    }
  });

  test('stops cleanly', async () => {
    server = await startWebServer();
    const url = server.url;

    await server.stop();

    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  });

  test('stop is idempotent', async () => {
    server = await startWebServer();
    await server.stop();
    await server.stop();
  });

  test('unknown /api route returns a JSON 404 rather than the SPA', async () => {
    server = await startWebServer();
    const res = await fetch(`${server.url}/api/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect((await res.json()).error).toBeDefined();
  });

  test('serves the SPA index with Cache-Control: no-store so a rebuilt bundle is not served stale', async () => {
    server = await startWebServer();
    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('watches the resolved assembly dir and closes the watcher on stop', async () => {
    let seenDir: string | undefined;
    let closed = false;
    server = await startWebServer({
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
    server = await startWebServer({
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

  test('starts a source watcher and closes it on stop', async () => {
    let closed = false;
    server = await startWebServer({
      startAssemblyWatcher: () => ({ close: async () => undefined }),
      startSourceWatcher: (opts) => {
        expect(opts.appDir).toBeDefined();
        return {
          close: async () => {
            closed = true;
          },
        };
      },
    });

    await server.stop();
    expect(closed).toBe(true);
  });

  test('broadcasts a source-changed event when the source watcher fires', async () => {
    let fireSourceChange = (): void => undefined;
    server = await startWebServer({
      startAssemblyWatcher: () => ({ close: async () => undefined }),
      startSourceWatcher: (opts) => {
        fireSourceChange = opts.onChange;
        return { close: async () => undefined };
      },
    });

    const res = await fetch(`${server.url}/api/events`);
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();

    fireSourceChange();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain(`event: ${SOURCE_CHANGED}`);

    await reader.cancel();
  });
});
