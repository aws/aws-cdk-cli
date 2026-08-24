import * as crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

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

/** Cookie the browser carries the session token in once the handshake has run. */
export const SESSION_COOKIE = 'cdk_explorer_session';

/** Query parameter the CLI-printed URL delivers the token in. */
export const TOKEN_QUERY_PARAM = 'token';

/**
 * A fresh session token. 256 bits from the CSPRNG, base64url so it survives a URL
 * and a `Set-Cookie` without escaping. Held in memory for the life of one
 * `cdk explore`: nothing writes it to disk, so a bookmarked URL stops working once
 * the server restarts — which is the point. A token that outlived the session
 * would be a credential sitting in the user's home directory.
 */
export function newSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Express middleware requiring the session token on every request.
 *
 * The token reaches the browser once, in the URL the CLI prints
 * (`http://localhost:4200/?token=…`). That request is answered with a `Set-Cookie`
 * and a redirect to the same path without the token, so the secret leaves the
 * address bar, history, and any bookmark. Everything after that — API calls, the
 * SPA bundle, and the SSE stream — rides the cookie, which the browser attaches
 * automatically. That indirection is not cosmetic: `EventSource` cannot set
 * request headers at all, so a header-based scheme could not authenticate
 * `/api/events`.
 *
 * What this buys: a local process calling `/api/file` has no cookie and no token,
 * so it is refused. To obtain the token it would have to read the user's terminal
 * output, browser cookie store, or this process's memory — which generally means
 * it already has the user's privileges. It does **not** defend against a
 * same-uid process (which can read the project files directly) or against root.
 * The gap it closes is a caller that can reach the port but not the filesystem: a
 * different user on a shared host, or a container sharing the network namespace.
 */
export function sessionAuth(token: string): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (tokenMatches(token, cookieValue(req.headers.cookie, SESSION_COOKIE))) {
      return next();
    }

    const presented = req.query[TOKEN_QUERY_PARAM];
    if (typeof presented === 'string' && tokenMatches(token, presented)) {
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      });
      // A browser navigation bounces to the token-free URL. An API call cannot be
      // redirected without breaking the caller, so it is simply served.
      return req.path.startsWith('/api/') ? next() : res.redirect(302, urlWithoutToken(req));
    }

    return refuse(req, res);
  };
}

/**
 * Compare in constant time, so a caller cannot recover the token a byte at a time
 * by measuring how long a rejection takes. Length is compared first because
 * `timingSafeEqual` throws on a mismatch; the token's length is fixed and public.
 */
function tokenMatches(expected: string, presented: string | undefined): boolean {
  if (presented === undefined) return false;
  const a = Buffer.from(expected, 'utf-8');
  const b = Buffer.from(presented, 'utf-8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Read one cookie out of a `Cookie` header. Hand-parsed rather than pulling in
 * `cookie-parser`: the explorer needs exactly one name, and the CLI bundles its
 * runtime dependencies.
 */
function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** The request's own path and query with the token stripped out. */
function urlWithoutToken(req: Request): string {
  // originalUrl is path-relative, so the base is only there to satisfy the parser.
  const url = new URL(req.originalUrl, 'http://localhost');
  url.searchParams.delete(TOKEN_QUERY_PARAM);
  return `${url.pathname}${url.search}`;
}

/**
 * Refuse an unauthenticated request. A browser navigation — most likely a
 * bookmark from a previous session, which is the accepted cost of a per-session
 * token — gets a readable explanation instead of a JSON blob.
 *
 * The test is a literal `text/html` in `Accept`, which is what a navigating
 * browser sends. `req.accepts('html')` would be wrong here: `fetch` and curl
 * default to a wildcard `Accept`, which matches `html` too and would hand every
 * programmatic caller a page of prose instead of a JSON error.
 */
function refuse(req: Request, res: Response): void {
  if ((req.headers.accept ?? '').includes('text/html')) {
    res.status(403).type('text/plain').send(
      'CDK Explorer: this page needs the link printed by `cdk explore`.\n\n'
      + 'The access token is generated fresh for each session, so a bookmarked or\n'
      + 'reloaded URL stops working once the explorer restarts. Run `cdk explore`\n'
      + 'again and open the URL it prints.\n',
    );
    return;
  }
  res.status(403).json({ error: 'forbidden: missing or invalid session token' });
}
