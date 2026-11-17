import * as net from 'net';
import type { Express } from '../../lib/expressy';
import { createApp } from '../../lib/expressy';
import { HttpServer } from '../../lib/expressy/http-server';

describe('with simple server', () => {
  let server: HttpServer;
  beforeEach(async () => {
    const app = createApp();
    app.get('/', (_req, res) => {
      res.send('OK');
    });
    server = new HttpServer(app, { host: 'localhost' });
    await server.start();
  });

  afterEach(async () => {
    await server.close();
  });

  test('simple page returns 200', async () => {
    const response = await fetch(server.urlString, { method: 'GET' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('OK');
  });

  test('missing page returns 404', async () => {
    const response = await fetch(`${server.urlString}/hello`, { method: 'GET' });
    expect(response.status).toBe(404);
  });

  test('invalid request returns 400', async () => {
    const response = await rawHttpRequest('localhost', server.port, [
      'GET //localhost:99999/ HTTP/1.1',
      'Host: localhost:9999',
      'Connection: close',
    ].join('\n'));

    expect(response).toContain('HTTP/1.1 400 Bad Request');
  });
});

test('a throwing handler returns 500', async () => {
  const app = createApp();
  app.get('/', (_req, _res) => {
    throw new Error('oopsie');
  });

  await withServer(app, async (server) => {
    const response = await fetch(server.urlString, { method: 'GET' });
    expect(response.status).toBe(500);
  });
});

/**
 * `redirect` is the only path to a `Location` header in the package, so it is
 * where the "stays on this origin" invariant is enforced.
 */
describe('redirect', () => {
  /** Serve a single route that redirects to `location`. */
  function appRedirectingTo(location: string): Express {
    const app = createApp();
    app.get('/', (_req, res) => {
      res.redirect(302, location);
    });
    return app;
  }

  test('sends a rooted relative target', async () => {
    await withServer(appRedirectingTo('/x?stack=Foo'), async (server) => {
      const response = await fetch(server.urlString, { redirect: 'manual' });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/x?stack=Foo');
    });
  });

  test.each([
    // Protocol-relative: the browser keeps the scheme and swaps the host.
    ['a protocol-relative target', '//evil.com/x'],
    // A backslash after the root slash: for a special scheme the URL parser
    // treats `\` as `/`, so this resolves to http://evil.com/x as well.
    ['a backslash-escaped authority', '/\\evil.com/x'],
    ['an absolute target', 'http://evil.com/x'],
  ])('refuses %s', async (_name, location) => {
    await withServer(appRedirectingTo(location), async (server) => {
      const response = await fetch(server.urlString, { redirect: 'manual' });

      // A throw in the handler surfaces as a 500. Failing loudly is the point:
      // silently rewriting the target would hide the caller's bug.
      expect(response.status).toBe(500);
      expect(response.headers.get('location')).toBeNull();
    });
  });
});

async function withServer(app: Express, block: (server: HttpServer) => Promise<void>) {
  const server = new HttpServer(app, { host: 'localhost' });
  await server.start();
  try {
    await block(server);
  } finally {
    await server.close();
  }
}

async function rawHttpRequest(host: string, port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host, port }, () => {
      client.write(request);
    });
    let data = '';
    client.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    client.on('end', () => {
      resolve(data);
    });
    client.on('error', (err: Error) => {
      reject(err);
    });
  });
}
