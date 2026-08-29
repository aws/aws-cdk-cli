import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { MANIFEST_FILE } from '@aws-cdk/cloud-assembly-api';
import { Toolkit, NonInteractiveIoHost } from '@aws-cdk/toolkit-lib';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import express = require('express');
import { SseBroadcaster } from './events';
import { localOnly, newSessionToken, sessionAuth, TOKEN_QUERY_PARAM } from './local-only';
import { ASSEMBLY_CHANGED, SOURCE_CHANGED } from './protocol';
import { registerApi } from './routes';
import { StalenessTracker } from './staleness';
import { indexHtml, webAsset } from './web-assets';
import { toolkitAssemblyLock } from '../core/assembly-lock';
import {
  startAssemblyWatcher as defaultStartAssemblyWatcher,
  type AssemblyWatcher,
  type AssemblyWatcherOptions,
} from '../core/assembly-watcher';
import {
  startSourceWatcher as defaultStartSourceWatcher,
  type SourceWatcher,
  type SourceWatcherOptions,
} from '../core/source-watcher';

export const DEFAULT_PORT = 4200;
const MAX_PORT_ATTEMPTS = 100;
const HOST = 'localhost';

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
function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction): void {
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

export interface WebServerOptions {
  readonly port?: number;
  /**
   * Root of the CDK app. File listing/reading is confined here. Defaults to
   * `process.cwd()`.
   */
  readonly appDir?: string;
  /**
   * Cloud assembly directory to read the construct tree and violations from.
   * Defaults to `<appDir>/cdk.out`.
   */
  readonly assemblyDir?: string;
  /**
   * Starts the cdk.out watcher. Defaults to the real chokidar-backed watcher;
   * overridden in tests with a fake to drive change events deterministically.
   */
  readonly startAssemblyWatcher?: (options: AssemblyWatcherOptions) => AssemblyWatcher;
  /**
   * Starts the source-tree watcher that drives live staleness. Defaults to the
   * real chokidar-backed watcher; overridden in tests with a fake.
   */
  readonly startSourceWatcher?: (options: SourceWatcherOptions) => SourceWatcher;
  /**
   * Reports a non-fatal watcher error (live refresh stops updating). Defaults to
   * writing to stderr; the CLI command passes a sink that routes to its IoHost.
   */
  readonly onWatcherError?: (err: unknown) => void;
}

export interface WebServer {
  /**
   * Origin the server is listening on, with no token. Use it to build request
   * paths; it is not on its own enough to reach any endpoint.
   */
  readonly url: string;
  /**
   * The URL to give a human: {@link url} carrying the session token, which the
   * server trades for a cookie on first load. This is what the CLI prints.
   */
  readonly sessionUrl: string;
  /**
   * This session's token, regenerated on every start and never persisted. Exposed
   * for callers that drive the server programmatically (and for tests).
   */
  readonly token: string;
  stop(): Promise<void>;
}

/**
 * Starts the CDK Explorer web server.
 *
 * If no port is specified, auto-increments from the default until one is available.
 * If a port is explicitly specified and unavailable, throws.
 *
 * @returns A handle to the running server with its URL and a stop function.
 */
export async function startWebServer(options: WebServerOptions = {}): Promise<WebServer> {
  const appDir = options.appDir ?? process.cwd();
  // Single owner of where the cloud assembly lives: the same resolved path feeds
  // both the read endpoints and the change watcher, so the two never disagree.
  const assemblyDir = options.assemblyDir ?? path.join(appDir, 'cdk.out');

  // mtime of the assembly manifest (undefined when none exists yet). Used as the
  // staleness fallback reference (synth-finish time) when no synth-start lock was
  // observed for a generation.
  const manifestMtimeMs = (): number | undefined => {
    try {
      return fs.statSync(path.join(assemblyDir, MANIFEST_FILE)).mtimeMs;
    } catch {
      return undefined;
    }
  };

  const app = express();

  // Nothing needs the banner, and it hands a visiting page a free fingerprint of
  // what is listening on the port.
  app.disable('x-powered-by');

  // Hardening headers first, so even the 403s localOnly writes carry them.
  app.use(securityHeaders);

  // Confine every route to loopback callers before any handler runs. This is the
  // guard against DNS rebinding and cross-origin reads from a page the user visits.
  app.use(localOnly);

  // ...and then to callers holding this session's token, which is the only thing
  // that stops another local process — headers alone prove nothing about a caller
  // that is not a browser. The read API can read files under appDir, so both
  // layers run before any route.
  const token = newSessionToken();
  app.use(sessionAuth(token));

  // The Toolkit provides the assembly read lock (via fromAssemblyDirectory().
  // produce()); a non-interactive IoHost is fine here since stdout/stderr are
  // free in the web process, unlike the LSP's stdio channel.
  const toolkit = new Toolkit({ ioHost: new NonInteractiveIoHost() });
  // Owns source-file staleness: the assembly watcher advances its per-generation
  // reference (see onChange below) and feeds it synth-start activity, and
  // /api/file reads it.
  const staleness = new StalenessTracker();
  // Anchor to the assembly present at startup. The watcher uses ignoreInitial so
  // it never fires for an already-synthesized assembly; without this, a file
  // edited before the server started would not read as stale until the next
  // synth. No synth-start was observed, so this uses the manifest-mtime fallback.
  const initialManifestMtime = manifestMtimeMs();
  if (initialManifestMtime !== undefined) staleness.onAssemblyRefreshed(initialManifestMtime);
  registerApi(app, {
    appDir,
    assemblyDir,
    acquireAssemblyLock: toolkitAssemblyLock(toolkit),
    staleness,
  });

  // Live-refresh stream: browsers subscribe here and re-fetch when the assembly
  // changes. Registered before the /api catch-all so it is not treated as unknown.
  const events = new SseBroadcaster();
  app.get('/api/events', events.handle.bind(events));

  // Unknown /api routes must return JSON 404, not fall through to the SPA.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'unknown endpoint' }));

  // Serve the SPA from the embedded bundle (survives CLI bundling). Named assets
  // by path; any other GET falls back to index.html for client-side routing.
  // (securityHeaders already sets Cache-Control: no-store, which is what makes a
  // rebuilt bundle show up on reload despite its unversioned filename.)
  app.get('/:asset', (req, res, next) => {
    const asset = webAsset(req.params.asset);
    if (!asset) return next();
    return res.type(asset.contentType).send(asset.body);
  });
  app.get('*', (_req, res) => {
    const index = indexHtml();
    res.type(index.contentType).send(index.body);
  });

  const server = http.createServer(app);

  const port = options.port !== undefined
    ? await listenOnPort(server, options.port, HOST)
    : await listenWithPortSearch(server, DEFAULT_PORT, HOST);

  // Start watching only after the server is listening, so a failed bind does not
  // leave a watcher running. Any synth that rewrites cdk.out (an external
  // `cdk synth`/`cdk watch`, or a future in-process synth) wakes every browser.
  const startWatcher = options.startAssemblyWatcher ?? defaultStartAssemblyWatcher;
  const watcher = startWatcher({
    assemblyDir,
    onChange: () => {
      // Advance the staleness reference to this new generation before waking
      // browsers, so the /api/file they re-fetch reads the current reference.
      // The watcher is the single owner of the reference: it observes both the
      // synth-start lock (onSynthActivity) and the generation change here.
      const mtime = manifestMtimeMs();
      if (mtime !== undefined) staleness.onAssemblyRefreshed(mtime);
      events.broadcast(ASSEMBLY_CHANGED);
    },
    onSynthActivity: (atMs) => staleness.noteSynthActivity(atMs),
    onError: options.onWatcherError ?? ((err) =>
      process.stderr.write(`assembly watcher error: ${err instanceof Error ? err.message : String(err)}\n`)),
  });

  // Watch the app's source tree so an edit re-checks the open file's staleness
  // (and refreshes its content) immediately, without waiting for the next synth.
  const startSource = options.startSourceWatcher ?? defaultStartSourceWatcher;
  const sourceWatcher = startSource({
    appDir,
    onChange: () => events.broadcast(SOURCE_CHANGED),
    onError: options.onWatcherError ?? ((err) =>
      process.stderr.write(`source watcher error: ${err instanceof Error ? err.message : String(err)}\n`)),
  });

  let stopped = false;
  const url = `http://${HOST}:${port}`;
  return {
    url,
    sessionUrl: `${url}/?${TOKEN_QUERY_PARAM}=${token}`,
    token,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await watcher.close();
      await sourceWatcher.close();
      events.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

async function listenOnPort(
  server: http.Server,
  port: number,
  host: string,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return port;
}

async function listenWithPortSearch(
  server: http.Server,
  startPort: number,
  host: string,
): Promise<number> {
  for (let port = startPort; port < startPort + MAX_PORT_ATTEMPTS; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      return port;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + MAX_PORT_ATTEMPTS - 1}`);
}
