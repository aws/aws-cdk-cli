import type { Request, Response, NextFunction } from '../../expressy';

/**
 * Policy for the SPA. Everything it needs is same-origin or inlined by the
 * bundler, so the baseline is `'none'` and each directive opens only what the
 * build actually emits: the bundle (`script-src 'self'`), its data-URI fonts and
 * images, and same-origin `fetch`/`EventSource` (`connect-src 'self'`). The
 * payoff is that a script injected into a rendered file cannot phone home —
 * `connect-src 'self'` blocks the exfiltration a file viewer would otherwise
 * enable. `style-src` needs `'unsafe-inline'` for index.html's inline `<style>`
 * block and Cloudscape's runtime styles; React `style` props go through CSSOM and
 * are not covered by CSP either way.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Response hardening for every route, including the 403s `localOnly` writes.
 *
 * - `Content-Security-Policy` / `X-Frame-Options`: see above; the frame
 *   directives stop an attacker page from embedding the explorer at all.
 * - `X-Content-Type-Options`: the API answers `application/json`; without
 *   `nosniff` a cross-site `<script>`/`<link>` pointed at `/api/file` can get a
 *   response reinterpreted as script or CSS.
 * - `Referrer-Policy`: a `/api/file?path=…` URL names a path in the user's
 *   project; it must not travel in a `Referer`.
 * - `Cross-Origin-*`: keeps the explorer out of another origin's browsing
 *   context group and out of its subresource loads.
 * - `Cache-Control`: responses carry project source, and the bundle filename is
 *   unversioned — nothing here should ever be reused from a cache.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.set({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  });
  next();
}

