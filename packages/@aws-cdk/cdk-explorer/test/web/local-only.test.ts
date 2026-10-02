import type { Request, Response } from '../../lib/expressy';
import {
  isAllowedFetchSite,
  isAllowedOrigin,
  isLoopbackHost,
  localOnly,
} from '../../lib/web/middleware/local-only';

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
