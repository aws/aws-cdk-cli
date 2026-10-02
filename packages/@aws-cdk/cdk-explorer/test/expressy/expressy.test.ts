import * as net from 'net';
import type { Express } from '../../lib/expressy';
import { createApp } from '../../lib/expressy';
import { HttpServer } from '../../lib/expressy/http-server';

describe('with simple server', () => {
  let server: HttpServer;
  beforeEach(async () => {
    const app = createApp();
    app.get('/', (_req, res) => {
      res.send('OK');
    });
    server = new HttpServer(app, { host: 'localhost' });
    await server.start();
  });

  afterEach(async () => {
    await server.close();
  });

  test('simple page returns 200', async () => {
    const response = await fetch(server.urlString, { method: 'GET' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('OK');
  });

  test('missing page returns 404', async () => {
    const response = await fetch(`${server.urlString}/hello`, { method: 'GET' });
    expect(response.status).toBe(404);
  });

  test('invalid request returns 400', async () => {
    const response = await rawHttpRequest('localhost', server.port, [
      'GET //localhost:99999/ HTTP/1.1',
      'Host: localhost:9999',
      'Connection: close',
    ].join('\n'));

    expect(response).toContain('HTTP/1.1 400 Bad Request');
  });
});

test('a throwing handler returns 500', async () => {
  const app = createApp();
  app.get('/', (_req, _res) => {
    throw new Error('oopsie');
  });

  await withServer(app, async (server) => {
    const response = await fetch(server.urlString, { method: 'GET' });
    expect(response.status).toBe(500);
  });
});

async function withServer(app: Express, block: (server: HttpServer) => Promise<void>) {
  const server = new HttpServer(app, { host: 'localhost' });
  await server.start();
  try {
    await block(server);
  } finally {
    await server.close();
  }
}

async function rawHttpRequest(host: string, port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host, port }, () => {
      client.write(request);
    });
    let data = '';
    client.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    client.on('end', () => {
      resolve(data);
    });
    client.on('error', (err: Error) => {
      reject(err);
    });
  });
}
