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
  await client.connection.sendRequest('initialize', {
    processId: process.pid,
    capabilities: {},
    rootUri: null,
    initializationOptions: options ?? {},
  });
  await client.connection.sendNotification('initialized');
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
      processId: process.pid,
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
    const synthRequests: string[] = [];
    testClient = createTestClient({
      onSynthRequest: (dir) => synthRequests.push(dir),
    });
    await initializeClient(testClient, { applicationDir: '/tmp/test-project' });

    await testClient.connection.sendNotification('textDocument/didSave', {
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(synthRequests).toEqual(['/tmp/test-project']);
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

    await new Promise((r) => setTimeout(r, 50));
    expect(synthRequests).toEqual([]);
  });

  test('didSave does not throw without onSynthRequest configured', async () => {
    testClient = createTestClient();
    await initializeClient(testClient, { applicationDir: '/tmp/test-project' });

    await testClient.connection.sendNotification('textDocument/didSave', {
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });

    // Server should still be responsive after didSave with no callback
    await testClient.connection.sendRequest('shutdown');
  });

  test('shutdown completes without error', async () => {
    testClient = createTestClient();
    await initializeClient(testClient);

    await testClient.connection.sendRequest('shutdown');
  });
});
