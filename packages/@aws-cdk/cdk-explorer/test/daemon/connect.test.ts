import type { DaemonConnection } from '../../lib/daemon/connect';
import { connectToDaemon } from '../../lib/daemon/connect';
import { DaemonServer } from '../../lib/daemon/server';
import { socketPathForProject } from '../../lib/daemon/socket-path';

const TEST_PROJECT = `/tmp/cdk-connect-test-${process.pid}`;

describe('connectToDaemon', () => {
  let server: DaemonServer;
  let connection: DaemonConnection | undefined;

  afterEach(async () => {
    if (connection) {
      connection.close();
      connection = undefined;
    }
    if (server) {
      await server.stop();
    }
  });

  function startServer(options?: { onSynth?: () => Promise<void> }) {
    const socketPath = socketPathForProject(TEST_PROJECT);
    server = new DaemonServer({
      socketPath,
      projectDir: TEST_PROJECT,
      logFile: socketPath + '.log',
      onSynth: options?.onSynth ?? (() => Promise.resolve()),
      idleTimeoutMs: 60_000,
    });
    return server.start();
  }

  test('rejects connection on protocol version mismatch', async () => {
    await startServer();

    jest.resetModules();
    jest.doMock('../../lib/protocol', () => ({
      ...jest.requireActual('../../lib/protocol'),
      PROTOCOL_VERSION: 'wrong-version',
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { connectToDaemon: connectWithWrongVersion } = require('../../lib/daemon/connect');

    await expect(connectWithWrongVersion(TEST_PROJECT)).rejects.toThrow('protocol version mismatch');
  });

  test('receives messages via async iterable', async () => {
    await startServer({ onSynth: () => Promise.resolve() });
    connection = await connectToDaemon(TEST_PROJECT);

    connection.send({ type: 'subscribe' });
    connection.send({ type: 'requestSynth' });

    const iterator = connection.messages[Symbol.asyncIterator]();
    const result = await iterator.next();
    expect(result.done).toBe(false);
    expect(result.value.type).toBe('synthComplete');
  });

  test('iterable ends when server closes connection', async () => {
    await startServer();
    connection = await connectToDaemon(TEST_PROJECT);

    connection.send({ type: 'subscribe' });

    const iterator = connection.messages[Symbol.asyncIterator]();

    // Stop the server — should close connections
    await server.stop();

    const result = await iterator.next();
    expect(result.done).toBe(true);
  });

  test('send after close does not throw', async () => {
    await startServer();
    connection = await connectToDaemon(TEST_PROJECT);

    connection.close();
    // Should not throw
    connection.send({ type: 'subscribe' });
  });

  test('receives synthFailed messages', async () => {
    await startServer({ onSynth: () => Promise.reject(new Error('oops')) });
    connection = await connectToDaemon(TEST_PROJECT);

    connection.send({ type: 'subscribe' });
    connection.send({ type: 'requestSynth' });

    const iterator = connection.messages[Symbol.asyncIterator]();
    const result = await iterator.next();
    expect(result.done).toBe(false);
    expect(result.value.type).toBe('synthFailed');
  });

  test('multiple messages arrive in order', async () => {
    let synthCount = 0;
    let resolvers: Array<() => void> = [];

    await startServer({
      onSynth: () => new Promise<void>((resolve) => {
        synthCount++;
        resolvers.push(resolve);
      }),
    });
    connection = await connectToDaemon(TEST_PROJECT);

    connection.send({ type: 'subscribe' });
    connection.send({ type: 'requestSynth' });

    // Wait for synth to start
    await new Promise((r) => setTimeout(r, 20));
    expect(synthCount).toBe(1);

    // Queue another
    connection.send({ type: 'requestSynth' });

    // Complete first
    resolvers[0]();
    const iterator = connection.messages[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value.type).toBe('synthComplete');

    // Wait for queued to start and complete
    await new Promise((r) => setTimeout(r, 20));
    resolvers[1]();
    const second = await iterator.next();
    expect(second.value.type).toBe('synthComplete');
  });
});
