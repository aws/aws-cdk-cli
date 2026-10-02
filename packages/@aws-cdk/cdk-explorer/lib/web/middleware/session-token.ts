import * as crypto from 'crypto';
import type { Request, Response, NextFunction } from '../../expressy';

/** Cookie the browser carries the session token in once the handshake has run. */
export const SESSION_COOKIE = 'cdk_explorer_session';

/** Query parameter the CLI-printed URL delivers the token in. */
export const TOKEN_QUERY_PARAM = 'token';

/**
 * A fresh session token.
 *
 * Base64url so it survives a URL and a `Set-Cookie` without escaping.
 */
export function newSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Express middleware requiring the session token on every request.
 *
 * This is to prevent other processes on the user's machine from accessing the
 * API. Without a token, the local server would accept all requests.
 *
 * With a token (printed to the terminal by the CLI), we can be sure the server
 * only accepts requests from the intended client, which is the user's browser.
 *
 * If we didn't have this token, attackers that can run arbitrary code on your
 * machine but not access the files in your CDK project directory, would be able to
 * read the files in your CDK project directory.
 */
export function sessionAuth(token: string): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (tokenMatches(token, req.cookie(SESSION_COOKIE))) {
      return next();
    }

    const presented = req.query[TOKEN_QUERY_PARAM];
    if (typeof presented === 'string' && tokenMatches(token, presented)) {
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      });

      // After setting the cookie: if this is a request for an HTML page, redirect it.
      // If it is a request for an API endpoint, most clients do not handle redirects so
      // just serve it.
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
