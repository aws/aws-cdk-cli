/*
 * A minimal implementation of a web server framework, based on the express API.
 *
 * This implements only the slice of express the CDK Explorer web server relies
 * on: an app that is itself a Node `http` request listener, mountable routers,
 * path/param/wildcard route matching, ordered middleware with `next()`, and the
 * handful of request/response helpers the handlers call. It intentionally omits
 * everything else express does (view engines, body parsing, content
 * negotiation, error-handling middleware, etc.) so the CLI can bundle it without
 * pulling in a large dependency tree.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { makeRequest, type Request } from './request';
import { makeResponse, type Response } from './response';
export { Request, Response };

/** Marks an object as a mountable router, so `app.use` can tell it from a plain handler. */
const ROUTER = Symbol('expressy.router');

/**
 * Called to pass control to the next matching handler. An argument is accepted
 * for express source-compatibility but ignored: the explorer registers no
 * error-handling middleware, so a `next(err)` behaves like a plain `next()`.
 */
export type NextFunction = (err?: unknown) => void;

/** A request handler / middleware function. */
export type Handler = (req: Request, res: Response, next: NextFunction) => void;

/** How a compiled pattern reports a match against a path. */
interface MatchResult {
  /** Captured named parameters. */
  readonly params: Record<string, string>;
  /**
   * The portion of the path left for a mounted sub-router to match. For a full
   * (route) match this is the whole path; for a prefix (mount) match it is what
   * follows the prefix, so a router mounted at `/api` sees `/health`.
   */
  readonly remainder: string;
}

type Matcher = (path: string) => MatchResult | undefined;

/** One entry in a router's ordered list of middleware and routes. */
interface Layer {
  /** Restrict to a single HTTP method, or undefined to match any (i.e. `use`). */
  readonly method?: string;
  /** Test a path and, on a match, extract params and the sub-router remainder. */
  readonly match: Matcher;
  /** Run the layer, calling `next` to continue past it. */
  readonly dispatch: (req: Request, res: Response, remainder: string, next: NextFunction) => void;
}

/**
 * A mountable collection of middleware and routes. `Express` is a `Router` that
 * is additionally a Node request listener.
 */
export interface Router {
  /** @internal */
  readonly [ROUTER]: true;
  /** Register a GET route with one or more handlers. */
  get(path: string, ...handlers: Handler[]): this;
  /** Register path-less middleware. */
  use(handler: Handler): this;
  /** Register middleware or a sub-router mounted at a path prefix. */
  use(path: string, handler: Handler | Router): this;
  /** @internal Run this router's layers against a (possibly stripped) path. */
  handle(req: Request, res: Response, path: string, done: NextFunction): void;
}

/**
 * An express-like application: a `Router` that is also a Node HTTP request
 * listener, so it can be passed straight to `http.createServer`.
 */
export interface Express extends Router {
  (req: IncomingMessage, res: ServerResponse): void;
}

/** Escape a literal path segment for use inside a `RegExp`. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a route pattern into a full-path matcher. Supports literal segments,
 * `:name` parameters (one path segment each), and a bare `*` that matches any
 * path. A trailing slash is tolerated.
 */
function compileRoute(pattern: string): Matcher {
  if (pattern === '*') {
    return (path) => ({ params: {}, remainder: path });
  }

  const keys: string[] = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment === '') return '';
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '/([^/]+)';
      }
      return '/' + escapeRegExp(segment);
    })
    .join('');
  const regexp = new RegExp('^' + source + '/?$');

  return (path) => {
    const m = regexp.exec(path);
    if (!m) return undefined;
    const params: Record<string, string> = {};
    keys.forEach((key, i) => {
      const value = m[i + 1];
      if (value !== undefined) params[key] = decodeURIComponent(value);
    });
    return { params, remainder: path };
  };
}

/**
 * Compile a mount pattern into a prefix matcher. A router or middleware mounted
 * at `/api` matches `/api`, `/api/`, and `/api/anything`; the remainder passed
 * to the mounted handler has the prefix stripped (`/health`, or `/` when the
 * path is exactly the prefix). An undefined prefix matches every path.
 */
function compileMount(prefix: string | undefined): Matcher {
  if (prefix === undefined || prefix === '' || prefix === '/') {
    return (path) => ({ params: {}, remainder: path });
  }
  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return (path) => {
    if (path === normalized) return { params: {}, remainder: '/' };
    if (path.startsWith(normalized + '/')) {
      return { params: {}, remainder: path.slice(normalized.length) };
    }
    return undefined;
  };
}

/** Run a route's handlers in order, chaining `next` to the router's `next` when they're exhausted. */
function runHandlers(handlers: readonly Handler[], req: Request, res: Response, next: NextFunction): void {
  let i = 0;
  const step: NextFunction = () => {
    const handler = handlers[i++];
    if (!handler) return next();
    handler(req, res, step);
  };
  step();
}

/** Build the shared router core (used by both `Router` and `Express`). */
export function createRouter(): Router {
  const layers: Layer[] = [];

  const router = {
    [ROUTER]: true as const,

    get(path: string, ...handlers: Handler[]): Router {
      layers.push({
        method: 'GET',
        match: compileRoute(path),
        dispatch: (req, res, _remainder, next) => runHandlers(handlers, req, res, next),
      });
      return router;
    },

    use(pathOrHandler: string | Handler, maybeHandler?: Handler | Router): Router {
      const path = typeof pathOrHandler === 'string' ? pathOrHandler : undefined;
      const target = typeof pathOrHandler === 'string' ? maybeHandler! : pathOrHandler;

      if (isRouter(target)) {
        const sub = target;
        layers.push({
          match: compileMount(path),
          dispatch: (req, res, remainder, next) => sub.handle(req, res, remainder, next),
        });
      } else {
        const handler = target as Handler;
        layers.push({
          match: compileMount(path),
          dispatch: (req, res, _remainder, next) => handler(req, res, next),
        });
      }
      return router;
    },

    handle(req: Request, res: Response, path: string, done: NextFunction): void {
      let i = 0;
      const next: NextFunction = () => {
        const layer = layers[i++];
        if (!layer) return done();
        if (layer.method && layer.method !== req.method) return next();
        const match = layer.match(path);
        if (!match) return next();
        req.params = { ...req.params, ...match.params };
        layer.dispatch(req, res, match.remainder, next);
      };
      next();
    },
  } satisfies Router;

  return router;
}

/** True when a value is a mountable router produced by {@link createRouter}. */
function isRouter(value: unknown): value is Router {
  return typeof value === 'object' && value !== null && (value as any)[ROUTER] === true;
}

/**
 * Create an express-like application. Returned as a function so it can be passed
 * directly to `http.createServer`, with the router methods (`get`, `use`) and
 * `attached to it.
 */
export function createApp(): Express {
  const router = createRouter();

  const app = ((raw: IncomingMessage, rawRes: ServerResponse): void => {
    const res = makeResponse(rawRes);

    // Parsing the request can fail, handle it gracefully
    let req: Request;
    try {
      req = makeRequest(raw);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`${raw.method} ${raw.url}:`, e);
      res.status(400).end();
      return;
    }

    try {
      router.handle(req, res, req.path, () => {
        // Nothing matched: mirror express's default 404.
        if (!res.headersSent) {
          res.status(404);
          res.set('Content-Type', 'text/plain; charset=utf-8');
        }
        res.send(`Cannot ${req.method} ${req.path}`);
        res.end();
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`${raw.method} ${raw.url}:`, e);
      res.status(500).send('Internal Server Error');
      return;
    }
  }) as Express;

  app.get = (path, ...handlers) => {
    router.get(path, ...handlers);
    return app;
  };
  app.use = (pathOrHandler: string | Handler, maybeHandler?: Handler | Router) => {
    (router.use as any)(pathOrHandler, maybeHandler);
    return app;
  };
  app.handle = (req, res, path, done) => router.handle(req, res, path, done);
  (app as any)[ROUTER] = true;

  return app;
}
