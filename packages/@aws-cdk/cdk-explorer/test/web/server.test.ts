import { SESSION_COOKIE } from '../../lib/web/local-only';
import { ASSEMBLY_CHANGED, SOURCE_CHANGED } from '../../lib/web/protocol';
import { startWebServer, DEFAULT_PORT, type WebServer, type WebServerOptions } from '../../lib/web/server';

/**
 * Node's global `fetch` keeps connections alive in a pool keyed by origin, which
 * two things here have to work around.
 *
 * Each test gets its own port, so no test can be handed a socket belonging to an
 * earlier test's already-closed server — that surfaced as an intermittent
 * "other side closed". Tests that assert port-selection behavior pick their own
 * ports instead.
 */
let nextPort = 4300;
const freshPort = (): number => nextPort++;

/**
 * Nothing in this file exercises real file watching, and the chokidar default
 * walks the whole package directory — slow, dependent on the cwd, and it holds
 * filesystem handles open past the end of the test. Watcher behavior is driven
 * through the fakes in the watcher-specific tests below.
 */
const NO_WATCHERS = {
  startAssemblyWatcher: () => ({ close: async () => undefined }),
  startSourceWatcher: () => ({ close: async () => undefined }),
};

describe('Web Server', () => {
  let server: WebServer;

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  /** Start on a port of its own, with the watchers stubbed unless a test overrides them. */
  function start(options: WebServerOptions = {}): Promise<WebServer> {
    return startWebServer({ port: freshPort(), ...NO_WATCHERS, ...options });
  }

  /**
   * And every request closes its connection rather than leaving it pooled, so the
   * per-port sockets do not accumulate across the file and keep the jest worker
   * from exiting.
   */
  function req(url: string, init: RequestInit = {}): Promise<Response> {
    return fetch(url, { ...init, headers: { ...init.headers, Connection: 'close' } });
  }

  /**
   * Request this server as an already-authenticated browser would: everything past
   * the one-time `?token=` handshake carries the session cookie, so this is the
   * state the SPA spends its whole life in.
   */
  function authed(path: string, init: RequestInit = {}): Promise<Response> {
    return req(`${server.url}${path}`, {
      ...init,
      headers: { ...init.headers, Cookie: `${SESSION_COOKIE}=${server.token}` },
    });
  }

  test('starts and responds to health check', async () => {
    server = await start();

    const res = await authed('/api/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  test('binds to localhost by default', async () => {
    server = await start();
    expect(server.url).toMatch(/^http:\/\/localhost:\d+$/);
  });

  test('auto-increments port by 1 when default is taken', async () => {
    const first = await start({ port: DEFAULT_PORT });
    server = await startWebServer({ ...NO_WATCHERS });

    expect(first.url).toBe(`http://localhost:${DEFAULT_PORT}`);
    expect(server.url).toBe(`http://localhost:${DEFAULT_PORT + 1}`);
    await first.stop();
  });

  test('throws when explicit port is taken', async () => {
    const first = await start({ port: 4567 });
    try {
      await expect(start({ port: 4567 })).rejects.toThrow();
    } finally {
      await first.stop();
    }
  });

  test('stops cleanly', async () => {
    server = await start();
    const url = server.url;

    await server.stop();

    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  });

  test('stop is idempotent', async () => {
    server = await start();
    await server.stop();
    await server.stop();
  });

  test('unknown /api route returns a JSON 404 rather than the SPA', async () => {
    server = await start();
    const res = await authed('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect((await res.json()).error).toBeDefined();
  });

  test('serves the SPA index with Cache-Control: no-store so a rebuilt bundle is not served stale', async () => {
    server = await start();
    const res = await authed('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('hardens every response and does not advertise the server implementation', async () => {
    server = await start();

    // The SPA document, a bundled asset, and the API: the middleware runs ahead of
    // all three, so every response carries the same headers.
    for (const route of ['/', '/bundle.js', '/api/health']) {
      const res = await authed(route);
      const headers = Object.fromEntries(res.headers);

      expect(res.status).toBe(200);
      expect(headers).toMatchObject({
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-resource-policy': 'same-origin',
        'cache-control': 'no-store',
      });
      expect(headers['x-powered-by']).toBeUndefined();
      // Same-origin only: the SPA's own bundle, its inlined assets, and its fetches.
      expect(headers['content-security-policy']).toContain("default-src 'none'");
      expect(headers['content-security-policy']).toContain("script-src 'self'");
      expect(headers['content-security-policy']).toContain("connect-src 'self'");
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    }
  });

  test('carries hardening headers on a rejected request too', async () => {
    server = await start();
    const res = await authed('/api/health', { headers: { Origin: 'http://evil.com' } });

    expect(res.status).toBe(403);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  test('rejects a cross-site subresource load with 403', async () => {
    server = await start();
    // A `<script src>`/`<link href>` from an attacker page: loopback Host, no Origin.
    const res = await authed('/api/file?path=cdk.json', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(res.status).toBe(403);
  });

  describe('session token', () => {
    test('refuses an unauthenticated request, which is what another local process sends', async () => {
      server = await start();

      // Exactly what `curl http://localhost:4200/api/file?path=...` looks like: a
      // loopback Host, no Origin, no Sec-Fetch-Site, and no token.
      const res = await req(`${server.url}/api/file?path=cdk.json`);

      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/session token/);
    });

    test('refuses a wrong token without leaking whether the length was right', async () => {
      server = await start();

      const sameLength = await req(`${server.url}/api/health?token=${'x'.repeat(server.token.length)}`);
      const shorter = await req(`${server.url}/api/health?token=nope`);

      expect(sameLength.status).toBe(403);
      expect(shorter.status).toBe(403);
    });

    test('trades the printed URL for a cookie and redirects the token out of the address bar', async () => {
      server = await start();

      const res = await req(server.sessionUrl, { redirect: 'manual' });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain(`${SESSION_COOKIE}=${server.token}`);
      // HttpOnly keeps script on another localhost port from reading it; Strict keeps
      // the browser from attaching it to a cross-site request.
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Strict/i);
    });

    test('the cookie from the handshake is what then serves the SPA', async () => {
      server = await start();

      // Node's fetch has no cookie jar, so the browser's two legs are done by hand:
      // follow the printed URL, keep the Set-Cookie, then request the redirect target
      // with it. Without the cookie this second request is a 403 (asserted below).
      const handshake = await req(server.sessionUrl, { redirect: 'manual' });
      const cookie = handshake.headers.get('set-cookie')!.split(';')[0];
      const location = handshake.headers.get('location')!;

      const withCookie = await req(`${server.url}${location}`, { headers: { Cookie: cookie } });
      expect(withCookie.status).toBe(200);
      expect(withCookie.headers.get('content-type')).toMatch(/text\/html/);

      const withoutCookie = await req(`${server.url}${location}`);
      expect(withoutCookie.status).toBe(403);
    });

    test('explains itself in plain text when a browser navigates without a token', async () => {
      server = await start();

      // A bookmark from a previous session: the accepted cost of a per-session token.
      const res = await req(`${server.url}/`, { headers: { Accept: 'text/html' } });

      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/text\/plain/);
      expect(await res.text()).toMatch(/cdk explore/);
    });

    test('serves an API call carrying the token in the query without redirecting it', async () => {
      server = await start();

      const res = await req(`${server.url}/api/health?token=${server.token}`, { redirect: 'manual' });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    });

    test('issues a distinct token per session, so a stale one does not carry over', async () => {
      server = await start();
      const first = server.token;
      await server.stop();

      server = await start();
      expect(server.token).not.toBe(first);

      const res = await req(`${server.url}/api/health?token=${first}`);
      expect(res.status).toBe(403);
    });
  });

  test('watches the resolved assembly dir and closes the watcher on stop', async () => {
    let seenDir: string | undefined;
    let closed = false;
    server = await start({
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
    server = await start({
      startAssemblyWatcher: (opts) => {
        fireChange = opts.onChange;
        return { close: async () => undefined };
      },
    });

    const res = await authed('/api/events');
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
    server = await start({
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
    server = await start({
      startAssemblyWatcher: () => ({ close: async () => undefined }),
      startSourceWatcher: (opts) => {
        fireSourceChange = opts.onChange;
        return { close: async () => undefined };
      },
    });

    const res = await authed('/api/events');
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();

    fireSourceChange();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain(`event: ${SOURCE_CHANGED}`);

    await reader.cancel();
  });
});
