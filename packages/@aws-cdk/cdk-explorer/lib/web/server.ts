import * as fs from 'fs';
import * as path from 'path';
import { MANIFEST_FILE } from '@aws-cdk/cloud-assembly-api';
import { Toolkit, NonInteractiveIoHost } from '@aws-cdk/toolkit-lib';
import { SseBroadcaster } from './events';
import { localOnly } from './middleware/local-only';
import { securityHeaders } from './middleware/security-headers';
import { newSessionToken, sessionAuth, TOKEN_QUERY_PARAM } from './middleware/session-token';
import { ASSEMBLY_CHANGED, SOURCE_CHANGED } from './protocol';
import { registerApi } from './routes';
import { StalenessTracker } from './staleness';
import { webAsset } from './web-assets';
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
import { createApp } from '../expressy';
import { HttpServer } from '../expressy/http-server';

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

  const app = createApp();

  // Hardening headers first, so even the 403s localOnly writes carry them.
  app.use(securityHeaders);
  app.use(localOnly);

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
    const index = webAsset('index.html')!;
    res.type(index.contentType).send(index.body);
  });

  const server = new HttpServer(app, {
    host: 'localhost',
    port: options.port,
  });
  await server.start();

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
  const url = server.urlString;
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
      await server.close();
    },
  };
}
