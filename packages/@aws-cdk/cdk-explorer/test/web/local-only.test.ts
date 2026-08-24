import type { Request, Response } from 'express';
import {
  isAllowedFetchSite,
  isAllowedOrigin,
  isLoopbackHost,
  localOnly,
  newSessionToken,
  sessionAuth,
  SESSION_COOKIE,
} from '../../lib/web/local-only';

describe('isLoopbackHost', () => {
  test.each([
    'localhost',
    'localhost:4200',
    '127.0.0.1',
    '127.0.0.1:4200',
    '[::1]',
    '[::1]:4200',
  ])('accepts loopback host %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  test.each([
    undefined,
    '',
    'evil.com',
    'evil.com:4200',
    'localhost.evil.com',
    '169.254.169.254',
    'example.com',
  ])('rejects non-loopback host %s', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  test('allows a missing Origin (same-origin GET, curl, SSE)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  test.each([
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'http://[::1]:4200',
    'https://localhost',
  ])('allows loopback origin %s', (origin) => {
    expect(isAllowedOrigin(origin)).toBe(true);
  });

  test.each([
    'null',
    'http://evil.com',
    'https://evil.com:4200',
    'not-a-url',
  ])('rejects non-loopback origin %s', (origin) => {
    expect(isAllowedOrigin(origin)).toBe(false);
  });
});

describe('isAllowedFetchSite', () => {
  test.each([
    undefined,
    'same-origin',
    // A user-initiated navigation (typed URL, bookmark) reports "none".
    'none',
  ])('allows %s', (fetchSite) => {
    expect(isAllowedFetchSite(fetchSite)).toBe(true);
  });

  test('rejects a cross-site request, which a no-CORS subresource load sends no Origin for', () => {
    expect(isAllowedFetchSite('cross-site')).toBe(false);
  });

  test('rejects same-site, since a page on another localhost port would carry the session cookie', () => {
    expect(isAllowedFetchSite('same-site')).toBe(false);
  });
});

describe('localOnly middleware', () => {
  function fakeRes(): Response & { statusCode?: number; jsonBody?: unknown } {
    const res: any = {};
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.jsonBody = body;
      return res;
    };
    return res;
  }

  test('passes a loopback request through to the next handler', () => {
    const req = { headers: { host: 'localhost:4200' } } as unknown as Request;
    const res = fakeRes();
    const next = jest.fn();

    localOnly(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  test('rejects a non-loopback Host with 403 and does not call next', () => {
    const req = { headers: { host: 'evil.com:4200' } } as unknown as Request;
    const res = fakeRes();
    const next = jest.fn();

    localOnly(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.jsonBody as { error: string }).error).toMatch(/host/);
  });

  test('rejects a cross-origin request even with a loopback Host', () => {
    const req = { headers: { host: 'localhost:4200', origin: 'http://evil.com' } } as unknown as Request;
    const res = fakeRes();
    const next = jest.fn();

    localOnly(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.jsonBody as { error: string }).error).toMatch(/cross-origin/);
  });

  test('rejects a cross-site subresource load that sends a loopback Host and no Origin', () => {
    const req = {
      headers: { 'host': 'localhost:4200', 'sec-fetch-site': 'cross-site' },
    } as unknown as Request;
    const res = fakeRes();
    const next = jest.fn();

    localOnly(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.jsonBody as { error: string }).error).toMatch(/cross-site/);
  });

  test('passes a same-origin fetch from the SPA through', () => {
    const req = {
      headers: { 'host': 'localhost:4200', 'origin': 'http://localhost:4200', 'sec-fetch-site': 'same-origin' },
    } as unknown as Request;
    const res = fakeRes();
    const next = jest.fn();

    localOnly(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });
});

describe('newSessionToken', () => {
  test('returns a fresh, URL-safe, high-entropy token each call', () => {
    const a = newSessionToken();
    const b = newSessionToken();

    expect(a).not.toBe(b);
    // 32 random bytes as base64url: no padding, nothing needing escaping in a URL.
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('sessionAuth middleware', () => {
  const TOKEN = 'test-token-that-is-long-enough-to-be-realistic';

  function fakeReq(overrides: {
    path?: string;
    originalUrl?: string;
    cookie?: string;
    query?: Record<string, unknown>;
    accept?: string;
  } = {}): Request {
    const path = overrides.path ?? '/';
    return {
      path,
      originalUrl: overrides.originalUrl ?? path,
      headers: {
        ...(overrides.cookie === undefined ? {} : { cookie: overrides.cookie }),
        // What `fetch` and curl default to, unless a test says otherwise.
        accept: overrides.accept ?? '*/*',
      },
      query: overrides.query ?? {},
    } as unknown as Request;
  }

  /** Captures the calls sessionAuth makes, including the cookie and redirect. */
  function fakeRes() {
    const res: any = {};
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.jsonBody = body;
      return res;
    };
    res.type = (t: string) => {
      res.contentType = t;
      return res;
    };
    res.send = (body: unknown) => {
      res.body = body;
      return res;
    };
    res.cookie = (name: string, value: string, options: unknown) => {
      res.cookies = [...(res.cookies ?? []), { name, value, options }];
      return res;
    };
    res.redirect = (code: number, location: string) => {
      res.statusCode = code;
      res.redirectedTo = location;
      return res;
    };
    return res;
  }

  test('passes a request carrying the session cookie', () => {
    const res = fakeRes();
    const next = jest.fn();

    sessionAuth(TOKEN)(fakeReq({ cookie: `${SESSION_COOKIE}=${TOKEN}` }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  test('picks its cookie out from among others', () => {
    const res = fakeRes();
    const next = jest.fn();
    const cookie = `theme=dark; ${SESSION_COOKIE}=${TOKEN}; other=1`;

    sessionAuth(TOKEN)(fakeReq({ cookie }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('trades a valid query token for a cookie and redirects the token away', () => {
    const res = fakeRes();
    const next = jest.fn();
    const req = fakeReq({ path: '/', originalUrl: `/?token=${TOKEN}`, query: { token: TOKEN } });

    sessionAuth(TOKEN)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe('/');
    expect(res.cookies).toEqual([
      { name: SESSION_COOKIE, value: TOKEN, options: { httpOnly: true, sameSite: 'strict', path: '/' } },
    ]);
  });

  test('keeps the other query parameters when stripping the token', () => {
    const res = fakeRes();
    const req = fakeReq({
      path: '/',
      originalUrl: `/?theme=dark&token=${TOKEN}`,
      query: { theme: 'dark', token: TOKEN },
    });

    sessionAuth(TOKEN)(req, res, jest.fn());

    expect(res.redirectedTo).toBe('/?theme=dark');
  });

  test('serves an API request with a query token instead of redirecting it', () => {
    const res = fakeRes();
    const next = jest.fn();
    const req = fakeReq({
      path: '/api/health',
      originalUrl: `/api/health?token=${TOKEN}`,
      query: { token: TOKEN },
    });

    sessionAuth(TOKEN)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirectedTo).toBeUndefined();
    expect(res.cookies).toHaveLength(1);
  });

  test.each([
    ['no token at all', {}],
    ['a wrong token of the same length', { cookie: `${SESSION_COOKIE}=${'x'.repeat(TOKEN.length)}` }],
    ['a truncated token', { cookie: `${SESSION_COOKIE}=${TOKEN.slice(0, 10)}` }],
    ['a token with trailing junk', { cookie: `${SESSION_COOKIE}=${TOKEN}x` }],
    ['a different cookie only', { cookie: 'theme=dark' }],
    ['a wrong query token', { query: { token: 'nope' } }],
  ])('refuses %s with 403 JSON', (_name, overrides) => {
    const res = fakeRes();
    const next = jest.fn();

    sessionAuth(TOKEN)(fakeReq(overrides), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.jsonBody as { error: string }).error).toMatch(/session token/);
  });

  test('explains itself in plain text to a browser navigation', () => {
    const res = fakeRes();
    const next = jest.fn();
    // What Chrome/Firefox send on a top-level navigation.
    const accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

    sessionAuth(TOKEN)(fakeReq({ accept }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.contentType).toBe('text/plain');
    expect(res.body).toMatch(/cdk explore/);
  });

  test('answers a wildcard Accept with JSON, since that is fetch and curl rather than a browser', () => {
    const res = fakeRes();

    sessionAuth(TOKEN)(fakeReq({ accept: '*/*' }), res, jest.fn());

    expect(res.contentType).toBeUndefined();
    expect((res.jsonBody as { error: string }).error).toMatch(/session token/);
  });
});
