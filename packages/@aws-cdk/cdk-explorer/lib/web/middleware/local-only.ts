import type { Request, Response, NextFunction } from '../../expressy';

/**
 * Request admission for the explorer, in two layers that stop different callers.
 *
 * {@link localOnly} inspects headers only a browser sets on the caller's behalf
 * (`Host`, `Origin`, `Sec-Fetch-Site`), so it defends against a page the user
 * visits — DNS rebinding and cross-origin/cross-site reads. It is worthless
 * against a local process, which sets those headers to whatever it likes.
 *
 * {@link sessionAuth} closes that second gap with a per-session bearer token: a
 * caller has to have seen the URL the CLI printed, which generally means it
 * already has the user's privileges. Both layers are needed; neither replaces the
 * other.
 */

/**
 * Loopback hostnames the explorer will answer to. `[::1]` is included alongside
 * `::1` because `new URL('http://[::1]').hostname` keeps the brackets, while a
 * bare `Host: ::1` does not.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * True when a `Host` header names a loopback interface. The port is irrelevant;
 * only the hostname decides reachability. A missing or unparseable header is
 * rejected — every real browser and HTTP client sends a well-formed `Host`.
 *
 * This is the DNS-rebinding defense: a rebound attacker page connects to
 * 127.0.0.1 but the browser still sends the site's own hostname (`evil.com`) in
 * `Host`, which is not loopback and is refused.
 */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(`http://${hostHeader}`).hostname);
  } catch {
    return false;
  }
}

/**
 * True when an `Origin` header is either absent (same-origin GET, curl, SSE with
 * no document origin) or names a loopback origin. A cross-origin page reaching a
 * normally-resolved `localhost` sends its own `Origin` (`http://evil.com`), which
 * is refused; the literal string `null` (sandboxed/opaque origins) is refused.
 */
export function isAllowedOrigin(originHeader: string | undefined): boolean {
  if (originHeader === undefined) return true;
  if (originHeader === 'null') return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(originHeader).hostname);
  } catch {
    return false;
  }
}

/**
 * True unless `Sec-Fetch-Site` marks the request as cross-site. This closes the
 * hole the `Origin` check alone leaves: a no-CORS subresource load from an
 * attacker page (`<script src>`, `<link rel=stylesheet>`, `<img src>` pointed at
 * `http://localhost:4200/api/file?…`) sends a loopback `Host` and *no* `Origin`,
 * so it passes {@link isAllowedOrigin}. Browsers do send `Sec-Fetch-Site:
 * cross-site` on those.
 *
 * `same-site` is refused too. The SPA only ever calls its own origin, and cookies
 * on `localhost` are **not** isolated by port — a page served from
 * `http://localhost:3000` would send the session cookie to `http://localhost:4200`.
 * The browser's own CORS rules already stop it reading the response, and this
 * makes the server refuse the request outright.
 *
 * A missing header (curl, or a browser too old to send it) is allowed — this is
 * defense in depth over the `Host` and `Origin` checks, not a replacement for
 * them, and {@link sessionAuth} is what actually gates a non-browser caller.
 */
export function isAllowedFetchSite(fetchSiteHeader: string | undefined): boolean {
  return fetchSiteHeader !== 'cross-site' && fetchSiteHeader !== 'same-site';
}

/**
 * Express middleware confining the explorer to loopback callers. Registered
 * before every route — API, SSE, and the SPA assets — so no handler runs for a
 * rejected caller. Guards against DNS rebinding and cross-origin reads of the
 * unauthenticated read API (arbitrary file reads scoped to the app dir).
 */
export function localOnly(req: Request, res: Response, next: NextFunction): void {
  if (!isLoopbackHost(req.headers.host)) {
    res.status(403).json({ error: 'forbidden: host is not loopback' });
    return;
  }
  if (!isAllowedOrigin(req.headers.origin)) {
    res.status(403).json({ error: 'forbidden: cross-origin request rejected' });
    return;
  }
  if (!isAllowedFetchSite(req.headers['sec-fetch-site'] as string | undefined)) {
    res.status(403).json({ error: 'forbidden: cross-site request rejected' });
    return;
  }
  next();
}
