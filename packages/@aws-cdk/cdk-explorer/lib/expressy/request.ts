import type { IncomingHttpHeaders, IncomingMessage } from 'http';

/**
 * The inbound request. A structural subset of express's `Request`, backed by the
 * Node `IncomingMessage` the HTTP server hands us.
 */
export interface Request {
  /** Lowercased request headers, exactly as Node parsed them. */
  readonly headers: IncomingHttpHeaders;
  /** HTTP method (e.g. "GET"). */
  readonly method: string;
  /** Parsed query string. Repeated keys become arrays, matching express. */
  readonly query: Record<string, string | string[] | undefined>;
  /** Named route parameters captured from the matched path (e.g. `:asset`). */
  params: Record<string, string>;
  /** Request path with the query string removed. Always the full original path. */
  readonly path: string;
  /** The full original request URL (path plus query string). */
  readonly originalUrl: string;
  /** Subscribe to a raw request event (the explorer uses `'close'`). */
  on(event: string, listener: (...args: any[]) => void): this;

  /**
   * Read a cookie by name from the request headers.
   */
  cookie(name: string): string | undefined;
}

/** Wrap the raw Node request in the {@link Request} surface the handlers use. */
export function makeRequest(raw: IncomingMessage): Request {
  const url = new URL(raw.url ?? '/', 'http://localhost');
  const req: Request = {
    headers: raw.headers,
    method: raw.method ?? 'GET',
    query: parseQuery(url.searchParams),
    params: {},
    path: url.pathname,
    originalUrl: raw.url ?? '/',
    on(event, listener) {
      raw.on(event, listener);
      return req;
    },
    cookie(name: string) {
      return cookieValue(raw.headers.cookie, name);
    },
  };
  return req;
}

/** Parse a `URLSearchParams` into express's query shape (arrays for repeated keys). */
function parseQuery(params: URLSearchParams): Record<string, string | string[] | undefined> {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    query[key] = all.length > 1 ? all : all[0];
  }
  return query;
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
