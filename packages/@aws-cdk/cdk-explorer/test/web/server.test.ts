import * as net from 'net';
import { DEFAULT_PORT } from '../../lib/expressy/http-server';
import { SESSION_COOKIE } from '../../lib/web/middleware/session-token';
import { ASSEMBLY_CHANGED, SOURCE_CHANGED } from '../../lib/web/protocol';
import { startWebServer, type WebServer, type WebServerOptions } from '../../lib/web/server';
import { fetchHappens } from '../fetch-happens';

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
  function req(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const u = new URL(url, server.sessionUrl);
    // Merge the search params
    u.search = new URLSearchParams(Object.fromEntries([
      ...new URL(server.sessionUrl).searchParams.entries(),
      ...u.searchParams.entries(),
    ])).toString();

    return fetchHappens(u, {
      ...init,
      headers: {
        ...init.headers,
        Connection: 'close',
      },
    });
  }

  /**
   * Put a request target on the wire exactly as written and return the raw
   * response text.
   *
   * `fetch` resolves dot segments client-side — it turns `/.//evil.com/x` into
   * `//evil.com/x` before the request leaves — so a `fetch`-based test would
   * exercise the neighbouring case the server already handles and pass whether
   * or not the redirect target is validated. Only a raw socket reaches the
   * un-normalised path the server itself has to normalise.
   */
  function rawRequest(target: string): Promise<string> {
    const { hostname, port } = new URL(server.url);
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: hostname, port: Number(port) }, () => {
        socket.write([
          `GET ${target} HTTP/1.1`,
          `Host: ${hostname}:${port}`,
          'Connection: close',
          '',
          '',
        ].join('\r\n'));
      });
      let data = '';
      socket.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
  }

  test('starts and responds to health check', async () => {
    server = await start();

    const res = await req('/api/health');
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

  /**
   * Port 0 is the ask "give me any free port", so the port that ends up bound is
   * chosen by the OS and is never 0. The URL has to name that port rather than
   * the 0 that was requested: 0 is not a port anything can connect to, and the
   * URL is what the CLI prints for the user to open.
   */
  test('reports the OS-assigned port when asked to bind port 0', async () => {
    server = await start({ port: 0 });

    expect(Number(new URL(server.url).port)).toBeGreaterThan(0);

    // And the URL is actually usable, which is the whole point of reporting it.
    const res = await req('/api/health');
    expect(res.status).toBe(200);
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
    const res = await req('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect((await res.json()).error).toBeDefined();
  });

  test('serves the SPA index with Cache-Control: no-store so a rebuilt bundle is not served stale', async () => {
    server = await start();
    const res = await req('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('hardens every response and does not advertise the server implementation', async () => {
    server = await start();

    // The SPA document, a bundled asset, and the API: the middleware runs ahead of
    // all three, so every response carries the same headers.
    for (const route of ['/', '/bundle.js', '/api/health']) {
      const res = await req(route);
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
      // `connect-src 'self'` is the one that matters most — it is what stops a script
      // injected into a rendered project file from exfiltrating what it can read.
      for (const directive of [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ]) {
        expect(headers['content-security-policy']).toContain(directive);
      }
    }
  });

  test('hardens a JSON 404 as well, since it is written past the SPA routes', async () => {
    server = await start();
    const res = await req('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  test('carries hardening headers on a rejected request too', async () => {
    server = await start();
    const res = await req('/api/health', { headers: { Origin: 'http://evil.com' } });

    expect(res.status).toBe(403);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  test('rejects a cross-site subresource load with 403', async () => {
    server = await start();
    // A `<script src>`/`<link href>` from an attacker page: loopback Host, no Origin.
    const res = await req('/api/file?path=cdk.json', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/cross-site/);
  });

  test('rejects a same-site request, which a page on another localhost port sends', async () => {
    server = await start();
    // Cookies on localhost are not isolated by port, so `http://localhost:3000` would
    // hand over the session cookie the `authed` helper is simulating here.
    const res = await req('/api/file?path=cdk.json', { headers: { 'Sec-Fetch-Site': 'same-site' } });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/cross-site/);
  });

  test('serves a same-origin fetch from the SPA', async () => {
    server = await start();
    const res = await req('/api/health', {
      headers: { 'Origin': server.url, 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(res.status).toBe(200);
  });

  describe('session token', () => {
    test('refuses an unauthenticated request, which is what another local process sends', async () => {
      server = await start();

      // Exactly what `curl http://localhost:4200/api/file?path=...` looks like: a
      // loopback Host, no Origin, no Sec-Fetch-Site, and no token.
      const res = await fetch(`${server.url}/api/file?path=cdk.json`);

      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/session token/);
    });

    test('refuses a wrong token without leaking whether the length was right', async () => {
      server = await start();

      const sameLength = await fetch(`${server.url}/api/health?token=${'x'.repeat(server.token.length)}`);
      const shorter = await fetch(`${server.url}/api/health?token=nope`);

      expect(sameLength.status).toBe(403);
      expect(shorter.status).toBe(403);
    });

    test('trades the printed URL for a cookie and redirects the token out of the address bar', async () => {
      server = await start();

      const res = await fetch(server.sessionUrl, { redirect: 'manual' });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain(`${SESSION_COOKIE}=${server.token}`);
      // HttpOnly keeps script on another localhost port from reading it; Strict keeps
      // the browser from attaching it to a cross-site request. Path=/ so the one
      // handshake at `/` covers the API and the bundled assets too.
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Strict/i);
      expect(setCookie).toMatch(/Path=\//i);
    });

    test('keeps the rest of the query when it redirects the token out of the address bar', async () => {
      server = await start();

      // A deep link the CLI or a colleague pasted: only the token comes off.
      const res = await fetch(`${server.url}/?token=${server.token}&stack=Foo`, { redirect: 'manual' });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/?stack=Foo');
    });

    /**
     * `Pathname` may not always be a path. Prevent URL parser from resolving
     * `/.//evil.com/x` to `//evil.com/x` (leading slashes are an authority in
     * this case) which ensures a browser following `Location` does not end up
     * at `http://evil.com/x`.
     */
    test.each([
      ['a dot segment', '/.//evil.com/x'],
      ['a parent segment', '/..//evil.com/x'],
    ])('keeps the handshake redirect on-origin when %s collapses into an authority', async (_name, target) => {
      server = await start();

      const res = await rawRequest(`${target}?token=${server.token}`);

      expect(res).toContain('HTTP/1.1 302');
      expect(res).toMatch(/^location: \/evil\.com\/x\r?$/im);
      // The assertion that matters: no Location may begin with two slashes.
      expect(res).not.toMatch(/^location: \/\//im);
    });

    test('refuses a repeated token parameter rather than picking one of them', async () => {
      server = await start();

      // Two values parse to an array, which is not the string the check accepts —
      // so a caller cannot smuggle a good token past a bad one.
      const res = await fetch(`${server.url}/api/health?token=nope&token=${server.token}`);

      expect(res.status).toBe(403);
    });

    test('finds the session cookie alongside the other cookies a browser sends', async () => {
      server = await start();

      // The Cookie header is hand-parsed, so the name must not match by prefix and
      // the value must survive neighbours and the spaces between them.
      const res = await fetch(`${server.url}/api/health`, {
        headers: {
          Cookie: `other=1; ${SESSION_COOKIE}_decoy=nope; ${SESSION_COOKIE}=${server.token}; last=2`,
        },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    });

    test('accepts the cookie even when the query carries a wrong token', async () => {
      server = await start();

      // The cookie is checked first, so an already-authenticated SPA is not locked
      // out by a stale `?token=` left in a reloaded URL.
      const res = await fetch(`${server.url}/api/health?token=nope`, {
        headers: { Cookie: `${SESSION_COOKIE}=${server.token}` },
      });

      expect(res.status).toBe(200);
    });

    test('the cookie from the handshake is what then serves the SPA', async () => {
      server = await start();

      // Node's fetch has no cookie jar, so the browser's two legs are done by hand:
      // follow the printed URL, keep the Set-Cookie, then request the redirect target
      // with it. Without the cookie this second request is a 403 (asserted below).
      const handshake = await fetch(server.sessionUrl, { redirect: 'manual' });
      const cookie = handshake.headers.get('set-cookie')!.split(';')[0];
      const location = handshake.headers.get('location')!;

      const withCookie = await fetch(`${server.url}${location}`, { headers: { Cookie: cookie } });
      expect(withCookie.status).toBe(200);
      expect(withCookie.headers.get('content-type')).toMatch(/text\/html/);

      const withoutCookie = await fetch(`${server.url}${location}`);
      expect(withoutCookie.status).toBe(403);
    });

    test('explains itself in plain text when a browser navigates without a token', async () => {
      server = await start();

      // A bookmark from a previous session: the accepted cost of a per-session token.
      // The Accept header is the one Chrome and Firefox send on a navigation, so the
      // check has to find `text/html` among the other types rather than match it whole.
      const res = await fetch(`${server.url}/`, {
        headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8' },
      });

      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/text\/plain/);
      expect(await res.text()).toMatch(/cdk explore/);
    });

    test('answers a wildcard Accept with JSON, so a programmatic caller does not get prose', async () => {
      server = await start();

      // What `fetch` and curl default to. A wildcard technically matches html, which
      // is why the refusal tests for a literal `text/html` rather than negotiating.
      const res = await fetch(`${server.url}/api/health`, { headers: { Accept: '*/*' } });

      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      expect((await res.json()).error).toMatch(/session token/);
    });

    test('carries the hardening headers on a token refusal too', async () => {
      server = await start();

      // securityHeaders is registered ahead of sessionAuth, so a refusal is hardened
      // the same as a served response — including the plain-text page a browser gets.
      const res = await fetch(`${server.url}/`, { headers: { Accept: 'text/html' } });

      expect(res.status).toBe(403);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    });

    test('serves an API call carrying the token in the query without redirecting it', async () => {
      server = await start();

      const res = await fetch(`${server.url}/api/health?token=${server.token}`, { redirect: 'manual' });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    });

    test('issues a distinct token per session, so a stale one does not carry over', async () => {
      server = await start();
      const first = server.token;
      // base64url, so it survives the printed URL and the Set-Cookie unescaped.
      expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
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

    const res = await req('/api/events');
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

    const res = await req('/api/events');
    const body = res.body;
    if (!body) throw new Error('SSE response had no body');
    const reader = body.getReader();

    fireSourceChange();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain(`event: ${SOURCE_CHANGED}`);

    await reader.cancel();
  });
});
