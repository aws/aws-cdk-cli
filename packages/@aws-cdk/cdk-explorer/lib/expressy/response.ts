import type { ServerResponse } from 'http';
import type { SetCookie } from './cookies';
import { serializeSetCookieValue } from './cookies';

/**
 * The outbound response. A structural subset of express's `Response`, backed by
 * the Node `ServerResponse`. All setters return `this` so calls chain
 * (`res.status(404).json(...)`), as they do in express.
 */
export interface Response {
  headersSent: boolean;

  /** Set one header, or several at once from an object. */
  set(field: string, value: string): this;
  set(fields: Record<string, string>): this;
  /** Set the status code used by the next `json`/`send`/`end`. */
  status(code: number): this;
  /** Send a JSON body (sets `Content-Type: application/json` unless already set). */
  json(body: unknown): this;
  /** Send a string/Buffer body. */
  send(body: string | Buffer): this;
  /** Set the `Content-Type` header. A bare value is used verbatim when it looks like a MIME type. */
  type(contentType: string): this;
  /** Send a redirect with the given status code and `Location`. */
  redirect(code: number, location: string): void;
  /** Append a `Set-Cookie` header. */
  cookie(name: string, value: string, options?: SetCookie): this;
  /** Flush the status line and headers to the socket without ending the response (for SSE). */
  flushHeaders(): void;
  /** Write a raw chunk to the response body. */
  write(chunk: string | Buffer): boolean;
  /** End the response. */
  end(): void;
  /** Subscribe to a raw response event (the explorer uses `'error'`). */
  on(event: string, listener: (...args: any[]) => void): this;
}

/** Wrap the raw Node response in the {@link Response} surface the handlers use. */
export function makeResponse(raw: ServerResponse): Response {
  let statusCode = 200;

  const res: Response = {
    get headersSent() {
      return raw.headersSent;
    },
    set(field: string | Record<string, string>, value?: string) {
      if (typeof field === 'object') {
        for (const [name, val] of Object.entries(field)) raw.setHeader(name, val);
      } else {
        raw.setHeader(field, value as string);
      }
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      if (!raw.hasHeader('Content-Type')) raw.setHeader('Content-Type', 'application/json; charset=utf-8');
      raw.statusCode = statusCode;
      raw.end(JSON.stringify(body));
      return res;
    },
    send(body: string | Buffer) {
      raw.statusCode = statusCode;
      if (!Buffer.isBuffer(body) && !raw.hasHeader('Content-Type')) {
        raw.setHeader('Content-Type', 'text/html; charset=utf-8');
      }
      raw.end(body);
      return res;
    },
    type(contentType: string) {
      raw.setHeader('Content-Type', normalizeContentType(contentType));
      return res;
    },
    redirect(code: number, location: string) {
      if (!/^\/(?![/\\])/.test(location)) {
        throw new Error(`${location} is invalid and should not be traversed to`);
      }
      raw.setHeader('Location', location);
      raw.statusCode = code;
      raw.end();
    },
    cookie(name: string, value: string, options?: SetCookie) {
      const existing = raw.getHeader('Set-Cookie');
      const cookies = Array.isArray(existing) ? [...existing] : existing ? [String(existing)] : [];
      cookies.push(serializeSetCookieValue(name, value, options));
      raw.setHeader('Set-Cookie', cookies);
      return res;
    },
    flushHeaders() {
      raw.statusCode = statusCode;
      raw.flushHeaders();
    },
    write(chunk: string | Buffer) {
      return raw.write(chunk);
    },
    end() {
      raw.end();
    },
    on(event, listener) {
      raw.on(event, listener);
      return res;
    },
  };
  return res;
}

/**
 * Turn a `type` argument into a `Content-Type` value. Anything that already
 * looks like a MIME type (contains `/`) is used verbatim; the only bare name the
 * explorer passes is handled explicitly.
 */
function normalizeContentType(value: string): string {
  if (value.includes('/')) return value;
  if (value === 'html') return 'text/html; charset=utf-8';
  if (value === 'json') return 'application/json; charset=utf-8';
  if (value === 'text') return 'text/plain; charset=utf-8';
  return value;
}
