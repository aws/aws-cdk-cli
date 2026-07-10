import * as http from 'http';
import * as path from 'path';
import { Toolkit, NonInteractiveIoHost } from '@aws-cdk/toolkit-lib';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import express = require('express');
import { SseBroadcaster } from './events';
import { ASSEMBLY_CHANGED } from './protocol';
import { registerApi } from './routes';
import { startSourceWatcher, type SourceWatcher, type SourceWatcherOptions } from './source-watcher';
import { indexHtml, webAsset } from './web-assets';
import { toolkitAssemblyLock, type AcquireAssemblyLock } from '../core/assembly-lock';
import {
  startAssemblyWatcher as defaultStartAssemblyWatcher,
  type AssemblyWatcher,
  type AssemblyWatcherOptions,
} from '../core/assembly-watcher';
import { runSynth, type SynthRunResult } from '../core/synth-runner';

export const DEFAULT_PORT = 4200;
const MAX_PORT_ATTEMPTS = 100;
const HOST = 'localhost';

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
   * Reports a non-fatal watcher error (live refresh stops updating). Defaults to
   * writing to stderr; the CLI command passes a sink that routes to its IoHost.
   */
  readonly onWatcherError?: (err: unknown) => void;
  /** Runs a synth of the project, returning its outcome. */
  readonly synthRunner: (projectDir: string) => Promise<SynthRunResult>;
  /** Factory for the source file watcher that drives auto-synth. */
  readonly startSourceWatcher: (options: SourceWatcherOptions) => SourceWatcher;
  /**
   * Acquires the assembly read lock (derived from the shared Toolkit) so read
   * endpoints never observe a torn cdk.out mid-synth.
   */
  readonly acquireAssemblyLock: AcquireAssemblyLock;
}

export interface WebServer {
  readonly url: string;
  /** Current auto-synth-on-save state; changed via the /api/synth/auto endpoint. */
  readonly autoSynthEnabled: boolean;
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
export async function startWebServer(options: WebServerOptions): Promise<WebServer> {
  const appDir = options.appDir ?? process.cwd();
  // Single owner of where the cloud assembly lives: the same resolved path feeds
  // both the read endpoints and the change watcher, so the two never disagree.
  const assemblyDir = options.assemblyDir ?? path.join(appDir, 'cdk.out');

  const app = express();

  // Live-refresh + synth-status stream. Created before the synth guard so a
  // failed synth (manual or auto) can broadcast its outcome to browsers.
  const events = new SseBroadcaster();

  let autoSynthEnabled = false;
  let synthInFlight = false;
  // Drop-if-in-flight: mirrors lib/lsp/server.ts. The Toolkit's RWLock on
  // cdk.out is the real cross-process mutex; this in-process boolean is a
  // deliberate short-circuit before any synth setup work.
  async function guardedSynth(): Promise<SynthRunResult> {
    if (synthInFlight) return { status: 'lock-conflict' };
    synthInFlight = true;
    try {
      const result = await options.synthRunner(appDir);
      // Surface failures for every synth (manual or auto); success arrives
      // separately as an assembly-changed refresh.
      if (result.status === 'app-failure' || result.status === 'error') {
        events.broadcastSynthStatus({
          message: result.message,
          details: result.status === 'app-failure' ? result.details : undefined,
        });
      }
      return result;
    } finally {
      synthInFlight = false;
    }
  }
  const sourceWatcher = options.startSourceWatcher({
    appDir,
    onChange: () => {
      if (!autoSynthEnabled) return;
      void guardedSynth();
    },
  });

  registerApi(app, {
    appDir,
    assemblyDir,
    acquireAssemblyLock: options.acquireAssemblyLock,
    autoSynth: {
      get: () => autoSynthEnabled,
      set: (enabled) => {
        autoSynthEnabled = enabled;
      },
    },
    synth: guardedSynth,
  });

  // Browsers subscribe here for assembly-changed + synth-status. Registered
  // before the /api catch-all so it is not treated as unknown.
  app.get('/api/events', events.handle.bind(events));

  // Unknown /api routes must return JSON 404, not fall through to the SPA.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'unknown endpoint' }));

  // Serve the SPA from the embedded bundle (survives CLI bundling). Named assets
  // by path; any other GET falls back to index.html for client-side routing.
  // The bundle filename is unversioned, so disable caching to ensure a rebuilt
  // explorer is always picked up on reload rather than served stale by the browser.
  app.get('/:asset', (req, res, next) => {
    const asset = webAsset(req.params.asset);
    if (!asset) return next();
    res.set('Cache-Control', 'no-store');
    return res.type(asset.contentType).send(asset.body);
  });
  app.get('*', (_req, res) => {
    const index = indexHtml();
    res.set('Cache-Control', 'no-store');
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
    onChange: () => events.broadcast(ASSEMBLY_CHANGED),
    onError: options.onWatcherError ?? ((err) =>
      process.stderr.write(`assembly watcher error: ${err instanceof Error ? err.message : String(err)}\n`)),
  });

  let stopped = false;
  return {
    url: `http://${HOST}:${port}`,
    get autoSynthEnabled() {
      return autoSynthEnabled;
    },
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

export interface StartCdkExploreOptions {
  readonly port?: number;
  /**
   * Root of the CDK app; also the synth working directory. Defaults to
   * `process.cwd()`.
   */
  readonly appDir?: string;
  /**
   * Reports a non-fatal assembly-watcher error. The CLI command routes this to
   * its IoHost; defaults (in startWebServer) to stderr.
   */
  readonly onWatcherError?: (err: unknown) => void;
}

/**
 * Production entry point for `cdk explore`. Constructs a Toolkit + IoHost,
 * wires the synth runner and source watcher, and delegates to `startWebServer`.
 * Kept separate so `startWebServer` stays a pure testable factory: tests inject
 * a noop synthRunner and a fake watcher via that lower layer.
 */
export async function startCdkExplore(options: StartCdkExploreOptions = {}): Promise<WebServer> {
  // The one Toolkit for the web process: it owns the cdk.out read lock and runs
  // synths, so a synth write and an assembly read share a single lock owner. Its
  // default IoHost is NonInteractiveIoHost (stdout/stderr aren't our transport).
  const toolkit = new Toolkit({ ioHost: new NonInteractiveIoHost() });
  return startWebServer({
    port: options.port,
    appDir: options.appDir,
    onWatcherError: options.onWatcherError,
    synthRunner: (projectDir) => runSynth({ toolkit, projectDir }),
    acquireAssemblyLock: toolkitAssemblyLock(toolkit),
    startSourceWatcher,
  });
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
