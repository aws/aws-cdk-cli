import * as http from 'http';
import type { AddressInfo } from 'net';

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

    let startPort: number;
    let endPort: number;
    if (this.options.port) {
      startPort = this.options.port;
      endPort = startPort;
    } else {
      startPort = DEFAULT_PORT;
      endPort = startPort + 100;
    }

    this._port = await listenWithPortSearch(this.server, this.options.host, startPort, endPort);
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
  host: string,
  startPort: number,
  endPort: number,
): Promise<number> {
  for (let port = startPort; port <= endPort; port++) {
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
    } catch (err: any) {
      if (err.code !== 'EADDRINUSE') {
        throw err;
      }
    }
  }

  if (startPort === endPort) {
    throw new Error(`Port ${startPort} is already in use`);
  }

  throw new Error(`No available port found in range ${startPort}-${endPort}`);
}
