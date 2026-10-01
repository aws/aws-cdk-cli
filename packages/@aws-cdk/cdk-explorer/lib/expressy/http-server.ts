import * as http from 'http';
import { AddressInfo } from 'net';

export const DEFAULT_PORT = 3411;

export interface HttpServerOptions {
  host: string;
  port?: number;
}

export class HttpServer {
  private _port?: number;
  private server?: http.Server;

  constructor(private readonly app: http.RequestListener, private readonly options: HttpServerOptions) {
  }

  public get port(): number {
    if (this._port === undefined) {
      throw new Error('Server has not been started yet.');
    }
    return this._port;
  }

  public get urlString(): string {
    return `http://${this.options.host}:${this.port}`;
  }

  public async start(): Promise<void> {
    this.server = http.createServer(this.app);

    this._port = await listenWithPortSearch(this.server, this.options.port ?? DEFAULT_PORT, this.options.host);
  }

  public async close(force = false) {
    const server = this.server;
    if (!server) {
      return;
    }

    // Stop accepting new connections
    await new Promise<void>(ok => server.close(() => ok()));

    // Forcefully close all waiting requests
    if (force) {
      server.closeAllConnections();
    }

    this.server = undefined;
  }
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
      const address = server.address() as AddressInfo;
      return address.port;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + MAX_PORT_ATTEMPTS - 1}`);
}

const MAX_PORT_ATTEMPTS = 100;
