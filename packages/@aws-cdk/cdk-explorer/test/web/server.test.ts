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

  test('binds to 127.0.0.1 by default', async () => {
    server = await startWebServer();
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  test('auto-increments port by 1 when default is taken', async () => {
    const first = await startWebServer({ port: DEFAULT_PORT });
    server = await startWebServer();

    expect(first.url).toBe(`http://127.0.0.1:${DEFAULT_PORT}`);
    expect(server.url).toBe(`http://127.0.0.1:${DEFAULT_PORT + 1}`);
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
});
