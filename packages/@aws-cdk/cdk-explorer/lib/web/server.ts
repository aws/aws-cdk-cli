import * as http from 'http';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import express = require('express');

const DEFAULT_PORT = 4200;
const MAX_PORT_ATTEMPTS = 100;

export interface WebServerOptions {
  readonly port?: number;
  readonly host?: string;
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
  const host = options.host ?? '127.0.0.1';

  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const server = http.createServer(app);

  const port = options.port !== undefined
    ? await listenOnPort(server, host, options.port)
    : await listenWithPortSearch(server, host, DEFAULT_PORT);

  let stopped = false;
  return {
    url: `http://${host}:${port}`,
    stop: () => {
      if (stopped) return Promise.resolve();
      stopped = true;
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

async function listenOnPort(
  server: http.Server,
  host: string,
  port: number,
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
  host: string,
  startPort: number,
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
