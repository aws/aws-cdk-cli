import * as net from 'net';
import type { ClientMessage, DaemonMessage } from '../protocol';
import { PROTOCOL_VERSION } from '../protocol';
import { LineParser } from './line-parser';
import { socketPathForProject } from './socket-path';

export interface DaemonConnection {
  readonly messages: AsyncIterable<DaemonMessage>;
  send(msg: ClientMessage): void;
  close(): void;
}

export async function connectToDaemon(projectDir: string): Promise<DaemonConnection> {
  const socketPath = socketPathForProject(projectDir);
  const socket = await connectSocket(socketPath);

  const { accepted, leftover } = await performHandshake(socket);
  if (!accepted) {
    socket.destroy();
    throw new Error('Daemon rejected handshake: protocol version mismatch');
  }

  return createConnection(socket, leftover);
}

async function connectSocket(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath, () => resolve(socket));
    socket.on('error', reject);
  });
}

interface HandshakeResult {
  accepted: boolean;
  leftover: string;
}

const HANDSHAKE_TIMEOUT_MS = 5000;

async function performHandshake(socket: net.Socket): Promise<HandshakeResult> {
  socket.write(JSON.stringify({ type: 'handshake', version: PROTOCOL_VERSION }) + '\n');

  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Handshake timed out'));
    }, HANDSHAKE_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
    };

    const onData = (data: Buffer) => {
      buffer += data.toString();
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex !== -1) {
        cleanup();
        const line = buffer.slice(0, newlineIndex);
        const leftover = buffer.slice(newlineIndex + 1);
        let msg: DaemonMessage;
        try {
          msg = JSON.parse(line) as DaemonMessage;
        } catch {
          reject(new Error('Invalid JSON in handshake response'));
          return;
        }
        if (msg.type === 'handshakeAck') {
          resolve({ accepted: msg.accepted, leftover });
        } else {
          reject(new Error(`Expected handshakeAck, got ${msg.type}`));
        }
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function createConnection(socket: net.Socket, leftover: string): DaemonConnection {
  return {
    messages: createMessageIterable(socket, leftover),
    send(msg: ClientMessage): void {
      if (!socket.destroyed) {
        socket.write(JSON.stringify(msg) + '\n');
      }
    },
    close(): void {
      socket.destroy();
    },
  };
}

function createMessageIterable(socket: net.Socket, leftover: string): AsyncIterable<DaemonMessage> {
  return {
    [Symbol.asyncIterator](): AsyncIterableIterator<DaemonMessage> {
      const parser = new LineParser<DaemonMessage>();
      const queue: DaemonMessage[] = [];
      let resolve: ((value: IteratorResult<DaemonMessage>) => void) | undefined;
      let done = false;

      const enqueue = (messages: DaemonMessage[]) => {
        for (const msg of messages) {
          if (resolve) {
            const r = resolve;
            resolve = undefined;
            r({ value: msg, done: false });
          } else {
            queue.push(msg);
          }
        }
      };

      // Process any data that arrived during handshake
      if (leftover.length > 0) {
        enqueue(parser.feed(leftover));
      }

      socket.on('data', (data) => {
        enqueue(parser.feed(data.toString()));
      });

      socket.on('close', () => {
        done = true;
        if (resolve) {
          const r = resolve;
          resolve = undefined;
          r({ value: undefined as never, done: true });
        }
      });

      socket.on('error', () => {
        done = true;
        if (resolve) {
          const r = resolve;
          resolve = undefined;
          r({ value: undefined as never, done: true });
        }
      });

      return {
        next(): Promise<IteratorResult<DaemonMessage>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (done) {
            return Promise.resolve({ value: undefined as never, done: true });
          }
          return new Promise((r) => {
            resolve = r;
          });
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  };
}
