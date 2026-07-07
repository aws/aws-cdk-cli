import * as http from 'http';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import express = require('express');
import { SseBroadcaster } from './events';
import { ASSEMBLY_CHANGED } from './protocol';
import { registerApi } from './routes';
import { indexHtml, webAsset } from './web-assets';
import {
  startAssemblyWatcher as defaultStartAssemblyWatcher,
  type AssemblyWatcher,
  type AssemblyWatcherOptions,
} from '../core/assembly-watcher';

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
}

export interface WebServer {
  readonly url: string;
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

  const app = express();

  registerApi(app, { appDir, assemblyDir });

  // Live-refresh stream: browsers subscribe here and re-fetch when the assembly
  // changes. Registered before the /api catch-all so it is not treated as unknown.
  const events = new SseBroadcaster();
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
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await watcher.close();
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
