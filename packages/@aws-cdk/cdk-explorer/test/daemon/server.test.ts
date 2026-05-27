import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DaemonServer } from '../../lib/daemon/server';
import { PROTOCOL_VERSION, DaemonMessage, ClientMessage } from '../../lib/protocol';
import { infoPathForProject } from '../../lib/daemon/socket-path';

function uniqueSocketPath(): string {
  return path.join(os.tmpdir(), `cdk-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
}

function connectToSocket(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath, () => resolve(socket));
    socket.on('error', reject);
  });
}

function sendMessage(socket: net.Socket, msg: ClientMessage): void {
  socket.write(JSON.stringify(msg) + '\n');
}

function readMessages(socket: net.Socket): Promise<DaemonMessage[]> {
  return new Promise((resolve) => {
    const messages: DaemonMessage[] = [];
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          messages.push(JSON.parse(line) as DaemonMessage);
        }
      }
    });

    socket.on('close', () => resolve(messages));
  });
}

function waitForMessage(socket: net.Socket): Promise<DaemonMessage> {
  return new Promise((resolve) => {
    let buffer = '';
    const onData = (data: Buffer) => {
      buffer += data.toString();
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        socket.removeListener('data', onData);
        resolve(JSON.parse(line) as DaemonMessage);
      }
    };
    socket.on('data', onData);
  });
}

describe('DaemonServer', () => {
  let server: DaemonServer;
  let socketPath: string;
  const projectDir = '/tmp/test-project';

  beforeEach(() => {
    socketPath = uniqueSocketPath();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    try { fs.unlinkSync(socketPath); } catch {}
  });

  function createServer(options?: { onSynth?: (t: string) => Promise<void>; idleTimeoutMs?: number }) {
    server = new DaemonServer({
      socketPath,
      projectDir,
      logFile: socketPath + '.log',
      onSynth: options?.onSynth ?? (() => Promise.resolve()),
      idleTimeoutMs: options?.idleTimeoutMs,
    });
    return server;
  }

  test('starts and accepts connections', async () => {
    createServer();
    await server.start();

    const socket = await connectToSocket(socketPath);
    expect(socket.destroyed).toBe(false);
    socket.destroy();
  });

  test('writes info file on start', async () => {
    createServer();
    await server.start();

    const infoPath = infoPathForProject(projectDir);
    const content = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
    expect(content.pid).toBe(process.pid);
    expect(content.socketPath).toBe(socketPath);
    expect(content.version).toBe(PROTOCOL_VERSION);
  });

  test('removes info file and socket on stop', async () => {
    createServer();
    await server.start();

    const infoPath = infoPathForProject(projectDir);
    expect(fs.existsSync(infoPath)).toBe(true);

    await server.stop();
    expect(fs.existsSync(infoPath)).toBe(false);
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  test('handshake with matching version is accepted', async () => {
    createServer();
    await server.start();

    const socket = await connectToSocket(socketPath);
    sendMessage(socket, { type: 'handshake', version: PROTOCOL_VERSION });

    const response = await waitForMessage(socket);
    expect(response).toEqual({
      type: 'handshakeAck',
      version: PROTOCOL_VERSION,
      accepted: true,
    });
    socket.destroy();
  });

  test('handshake with mismatched version is rejected and triggers shutdown', async () => {
    createServer();
    await server.start();

    const socket = await connectToSocket(socketPath);
    const messages = readMessages(socket);
    sendMessage(socket, { type: 'handshake', version: 'wrong-version' });

    const received = await messages;
    expect(received[0]).toEqual({
      type: 'handshakeAck',
      version: PROTOCOL_VERSION,
      accepted: false,
    });
  });

  test('subscribe registers client for broadcasts', async () => {
    let synthResolve: () => void;
    const synthPromise = new Promise<void>((resolve) => { synthResolve = resolve; });
    createServer({ onSynth: () => { synthResolve(); return synthPromise; } });
    await server.start();

    const socket = await connectToSocket(socketPath);
    sendMessage(socket, { type: 'handshake', version: PROTOCOL_VERSION });
    await waitForMessage(socket);

    sendMessage(socket, { type: 'subscribe' });
    sendMessage(socket, { type: 'requestSynth', triggerFile: 'test.ts' });

    // Resolve the synth
    synthResolve!();
    const msg = await waitForMessage(socket);
    expect(msg.type).toBe('synthComplete');
    socket.destroy();
  });

  test('synth failure broadcasts synthFailed', async () => {
    createServer({ onSynth: () => Promise.reject(new Error('boom')) });
    await server.start();

    const socket = await connectToSocket(socketPath);
    sendMessage(socket, { type: 'handshake', version: PROTOCOL_VERSION });
    await waitForMessage(socket);

    sendMessage(socket, { type: 'subscribe' });
    sendMessage(socket, { type: 'requestSynth', triggerFile: 'test.ts' });

    const msg = await waitForMessage(socket);
    expect(msg.type).toBe('synthFailed');
    socket.destroy();
  });

  test('queued synth runs after current completes', async () => {
    let synthCount = 0;
    let resolvers: Array<() => void> = [];

    createServer({
      onSynth: () => new Promise<void>((resolve) => {
        synthCount++;
        resolvers.push(resolve);
      }),
    });
    await server.start();

    const socket = await connectToSocket(socketPath);
    sendMessage(socket, { type: 'handshake', version: PROTOCOL_VERSION });
    await waitForMessage(socket);
    sendMessage(socket, { type: 'subscribe' });

    // First request starts synth
    sendMessage(socket, { type: 'requestSynth', triggerFile: 'a.ts' });
    await new Promise((r) => setTimeout(r, 20));
    expect(synthCount).toBe(1);

    // Second request while first is running → queued
    sendMessage(socket, { type: 'requestSynth', triggerFile: 'b.ts' });
    await new Promise((r) => setTimeout(r, 20));
    expect(synthCount).toBe(1);

    // Complete first synth → queued one runs
    resolvers[0]();
    await waitForMessage(socket); // synthComplete for first
    await new Promise((r) => setTimeout(r, 20));
    expect(synthCount).toBe(2);

    resolvers[1]();
    const msg = await waitForMessage(socket); // synthComplete for second
    expect(msg.type).toBe('synthComplete');
    socket.destroy();
  });

  test('multiple subscribers all receive broadcasts', async () => {
    let synthResolve: () => void;
    const synthPromise = new Promise<void>((resolve) => { synthResolve = resolve; });
    createServer({ onSynth: () => synthPromise });
    await server.start();

    const socket1 = await connectToSocket(socketPath);
    const socket2 = await connectToSocket(socketPath);

    sendMessage(socket1, { type: 'handshake', version: PROTOCOL_VERSION });
    sendMessage(socket2, { type: 'handshake', version: PROTOCOL_VERSION });
    await waitForMessage(socket1);
    await waitForMessage(socket2);

    sendMessage(socket1, { type: 'subscribe' });
    sendMessage(socket2, { type: 'subscribe' });

    // Give the event loop time to process subscribes
    await new Promise((r) => setTimeout(r, 20));

    sendMessage(socket1, { type: 'requestSynth', triggerFile: 'x.ts' });

    // Give time for requestSynth to be processed, then resolve
    await new Promise((r) => setTimeout(r, 20));
    synthResolve!();

    const msg1 = await waitForMessage(socket1);
    const msg2 = await waitForMessage(socket2);
    expect(msg1.type).toBe('synthComplete');
    expect(msg2.type).toBe('synthComplete');

    socket1.destroy();
    socket2.destroy();
  });

  test('idle timeout triggers shutdown when no subscribers', async () => {
    createServer({ idleTimeoutMs: 50 });
    await server.start();

    // Server should shut down after 50ms with no subscribers
    await new Promise((r) => setTimeout(r, 100));
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  test('subscription cancels idle timeout', async () => {
    createServer({ idleTimeoutMs: 50 });
    await server.start();

    const socket = await connectToSocket(socketPath);
    sendMessage(socket, { type: 'handshake', version: PROTOCOL_VERSION });
    await waitForMessage(socket);
    sendMessage(socket, { type: 'subscribe' });

    // Wait longer than timeout
    await new Promise((r) => setTimeout(r, 100));

    // Server should still be running
    expect(fs.existsSync(socketPath)).toBe(true);
    socket.destroy();
  });

  test('shutdown message stops server', async () => {
    createServer();
    await server.start();

    const socket = await connectToSocket(socketPath);
    sendMessage(socket, { type: 'handshake', version: PROTOCOL_VERSION });
    await waitForMessage(socket);
    sendMessage(socket, { type: 'subscribe' });

    const messages = readMessages(socket);
    sendMessage(socket, { type: 'shutdown' });

    const received = await messages;
    expect(received.some((m) => m.type === 'shuttingDown')).toBe(true);
  });

  test('synth timeout broadcasts synthFailed', async () => {
    // onSynth that never resolves
    server = new DaemonServer({
      socketPath,
      projectDir,
      logFile: socketPath + '.log',
      onSynth: () => new Promise(() => {}),
      idleTimeoutMs: 60_000,
      synthTimeoutMs: 50,
    });
    await server.start();

    const socket = await connectToSocket(socketPath);
    sendMessage(socket, { type: 'handshake', version: PROTOCOL_VERSION });
    await waitForMessage(socket);
    sendMessage(socket, { type: 'subscribe' });
    sendMessage(socket, { type: 'requestSynth', triggerFile: 'hang.ts' });

    const msg = await waitForMessage(socket);
    expect(msg.type).toBe('synthFailed');
    if (msg.type === 'synthFailed') {
      expect(msg.error).toContain('timed out');
    }
    socket.destroy();
  });

  test('idle timer starts after subscriber socket errors out', async () => {
    createServer({ idleTimeoutMs: 50 });
    await server.start();

    const socket = await connectToSocket(socketPath);
    sendMessage(socket, { type: 'handshake', version: PROTOCOL_VERSION });
    await waitForMessage(socket);
    sendMessage(socket, { type: 'subscribe' });

    // Wait to confirm server stays alive with subscriber
    await new Promise((r) => setTimeout(r, 80));
    expect(fs.existsSync(socketPath)).toBe(true);

    // Simulate abrupt disconnect
    socket.destroy();

    // Idle timer should fire and shut down
    await new Promise((r) => setTimeout(r, 100));
    expect(fs.existsSync(socketPath)).toBe(false);
  });
});
