import { PassThrough } from 'stream';
import type { MessageConnection } from 'vscode-jsonrpc/node';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import { startServer, type LspServerOptions } from '../../lib/lsp/server';

interface TestClient {
  connection: MessageConnection;
  serverIn: PassThrough;
  serverOut: PassThrough;
}

function createTestClient(opts?: Partial<Pick<LspServerOptions, 'onSynthRequest'>>): TestClient {
  const serverIn = new PassThrough();
  const serverOut = new PassThrough();

  startServer({
    readable: serverIn,
    writable: serverOut,
    onSynthRequest: opts?.onSynthRequest,
  });

  const connection = createMessageConnection(
    new StreamMessageReader(serverOut),
    new StreamMessageWriter(serverIn),
  );
  connection.listen();

  return { connection, serverIn, serverOut };
}

async function initializeClient(client: TestClient, options?: Record<string, unknown>): Promise<void> {
  // processId: null prevents vscode-languageserver from registering an
  // undisposable parent-process watchdog timer that hangs jest.
  await client.connection.sendRequest('initialize', {
    processId: null,
    capabilities: {},
    rootUri: null,
    initializationOptions: options ?? {},
  });
  await client.connection.sendNotification('initialized');
}

interface LogMessage {
  type: number;
  message: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// didSave is a fire-and-forget notification. Tests gate on a deferred that
// the relevant callback (onSynthRequest, or window/logMessage) resolves —
// no setImmediate / setTimeout polling.
const TIMEOUT_MS = 1000;

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('LSP Server', () => {
  let testClient: TestClient;

  afterEach(() => {
    if (testClient) {
      testClient.connection.dispose();
      testClient.serverIn.end();
      testClient.serverOut.end();
    }
  });

  test('responds to initialize with capabilities', async () => {
    testClient = createTestClient();

    const result = await testClient.connection.sendRequest('initialize', {
      processId: null,
      capabilities: {},
      rootUri: null,
      initializationOptions: { applicationDir: '/tmp/test-project' },
    });

    expect(result).toMatchObject({
      capabilities: {
        textDocumentSync: {
          openClose: false,
          change: 0,
          save: { includeText: false },
        },
      },
    });
  });

  test('didSave triggers onSynthRequest for source files', async () => {
    const seen = deferred<string>();
    testClient = createTestClient({
      onSynthRequest: (dir) => seen.resolve(dir),
    });
    await initializeClient(testClient, { applicationDir: '/tmp/test-project' });

    await testClient.connection.sendNotification('textDocument/didSave', {
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });

    await expect(withTimeout(seen.promise, 'onSynthRequest')).resolves.toBe('/tmp/test-project');
  });

  test('didSave does not trigger for ignored files', async () => {
    const synthRequests: string[] = [];
    testClient = createTestClient({
      onSynthRequest: (dir) => synthRequests.push(dir),
    });
    await initializeClient(testClient, { applicationDir: '/tmp/test-project' });

    await testClient.connection.sendNotification('textDocument/didSave', {
      textDocument: { uri: 'file:///tmp/test-project/node_modules/foo/index.ts' },
    });
    await testClient.connection.sendNotification('textDocument/didSave', {
      textDocument: { uri: 'file:///tmp/test-project/cdk.out/tree.json' },
    });

    // Round-trip a request to drain the server's notification queue past the
    // two didSaves, then assert the synth callback was never invoked.
    await testClient.connection.sendRequest('shutdown');
    expect(synthRequests).toEqual([]);
  });

  test('didSave is a no-op when onSynthRequest is not provided', async () => {
    testClient = createTestClient();
    await initializeClient(testClient, { applicationDir: '/tmp/test-project' });

    await testClient.connection.sendNotification('textDocument/didSave', {
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });

    // Server stays responsive after didSave with no callback configured.
    await testClient.connection.sendRequest('shutdown');
  });

  test('didSave is ignored after shutdown', async () => {
    const synthRequests: string[] = [];
    testClient = createTestClient({
      onSynthRequest: (dir) => synthRequests.push(dir),
    });
    await initializeClient(testClient, { applicationDir: '/tmp/test-project' });

    await testClient.connection.sendRequest('shutdown');

    await testClient.connection.sendNotification('textDocument/didSave', {
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });

    // Best-effort drain: the post-shutdown didSave is a notification, no
    // request to await. Re-issuing shutdown rides the same queue and acks
    // only after the prior didSave has been processed.
    await testClient.connection.sendRequest('shutdown');
    expect(synthRequests).toEqual([]);
  });

  test('onSynthRequest errors are surfaced via window/logMessage', async () => {
    const logged = deferred<LogMessage>();
    testClient = createTestClient({
      onSynthRequest: () => {
        throw new Error('synth failed');
      },
    });
    testClient.connection.onNotification('window/logMessage', (params: LogMessage) => {
      if (params.message.includes('synth failed')) logged.resolve(params);
    });
    await initializeClient(testClient, { applicationDir: '/tmp/test-project' });

    await testClient.connection.sendNotification('textDocument/didSave', {
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });

    const message = await withTimeout(logged.promise, 'window/logMessage');
    expect(message.message).toContain('Synth request failed: synth failed');
  });
});
