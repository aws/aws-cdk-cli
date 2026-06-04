import { pathToFileURL } from 'url';
import type { Diagnostic } from 'vscode-languageserver/node';
import type { AssemblyReadResult } from '../../lib';
import { createLspHandlers, type LspHandlerOptions, type LspHandlers } from '../../lib/lsp/server';

interface CapturedClient {
  handlers: LspHandlers;
  published: Array<{ uri: string; diagnostics: Diagnostic[] }>;
  log: { warn: jest.Mock; error: jest.Mock };
}

function createTestClient(opts?: Partial<Pick<LspHandlerOptions, 'onSynthRequest' | 'readAssembly'>>): CapturedClient {
  const published: Array<{ uri: string; diagnostics: Diagnostic[] }> = [];
  const log = { warn: jest.fn(), error: jest.fn() };
  const handlers = createLspHandlers({
    onSynthRequest: opts?.onSynthRequest,
    // Default to "no assembly" so tests that don't care about diagnostics
    // don't need a fake fixture. Tests that do care override this.
    readAssembly: opts?.readAssembly ?? (() => ({ status: 'not-found' })),
    logger: log,
    onPublishDiagnostics: (uri, diagnostics) => published.push({ uri, diagnostics }),
  });
  return { handlers, published, log };
}

function initializeClient(client: CapturedClient, options?: Record<string, unknown>): void {
  client.handlers.onInitialize({
    processId: null,
    capabilities: {},
    rootUri: null,
    initializationOptions: options ?? {},
  });
  client.handlers.onInitialized();
}

describe('LSP Server', () => {
  test('responds to initialize with capabilities', () => {
    const client = createTestClient();

    const result = client.handlers.onInitialize({
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
        codeLensProvider: { resolveProvider: false },
      },
    });
  });

  test('didSave triggers onSynthRequest for source files', () => {
    const synthRequests: string[] = [];
    const client = createTestClient({
      onSynthRequest: (dir) => synthRequests.push(dir),
    });
    initializeClient(client, { applicationDir: '/tmp/test-project' });

    client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });

    expect(synthRequests).toEqual(['/tmp/test-project']);
  });

  test('didSave does not trigger for ignored files', () => {
    const synthRequests: string[] = [];
    const client = createTestClient({
      onSynthRequest: (dir) => synthRequests.push(dir),
    });
    initializeClient(client, { applicationDir: '/tmp/test-project' });

    client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/node_modules/foo/index.ts' },
    });
    client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/cdk.out/tree.json' },
    });

    expect(synthRequests).toEqual([]);
  });

  test('didSave does not throw without onSynthRequest configured', () => {
    const client = createTestClient();
    initializeClient(client, { applicationDir: '/tmp/test-project' });

    expect(() => client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    })).not.toThrow();

    // Server should still be responsive after didSave with no callback
    expect(() => client.handlers.onShutdown()).not.toThrow();
  });

  test('shutdown completes without error', () => {
    const client = createTestClient();
    initializeClient(client);

    expect(() => client.handlers.onShutdown()).not.toThrow();
  });

  test('didSave is ignored after shutdown', () => {
    const synthRequests: string[] = [];
    const client = createTestClient({
      onSynthRequest: (dir) => synthRequests.push(dir),
    });
    initializeClient(client, { applicationDir: '/tmp/test-project' });

    client.handlers.onShutdown();

    client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });

    expect(synthRequests).toEqual([]);
  });

  test('onSynthRequest errors are caught gracefully', () => {
    const client = createTestClient({
      onSynthRequest: () => {
        throw new Error('synth failed');
      },
    });
    initializeClient(client, { applicationDir: '/tmp/test-project' });

    expect(() => client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    })).not.toThrow();

    // Server should still be responsive after the error
    expect(() => client.handlers.onShutdown()).not.toThrow();
  });

  test('publishes diagnostics on initialized when assembly has violations', () => {
    const client = createTestClient({
      readAssembly: () => ({
        status: 'success',
        data: {
          tree: [{
            path: 'Stack1',
            id: 'Stack1',
            children: [{
              path: 'Stack1/MyBucket',
              id: 'MyBucket',
              children: [],
              sourceLocation: { file: '/p/lib/stack.ts', line: 12, column: 5 },
            }],
          }],
          violations: {
            version: '1.0.0',
            pluginReports: [{
              pluginName: 'test-plugin',
              conclusion: 'failure',
              violations: [{
                ruleName: 'no-public-buckets',
                description: 'no public buckets',
                severity: 'error',
                violatingConstructs: [{ constructPath: 'Stack1/MyBucket' }],
              }],
            }],
          },
        },
      }),
    });

    initializeClient(client, { applicationDir: '/p' });

    expect(client.published).toHaveLength(1);
    expect(client.published[0].uri).toContain('stack.ts');
    expect(client.published[0].diagnostics).toHaveLength(1);
  });

  test('responds to codeLens with resources for the requested file', () => {
    const stackTs = '/p/lib/stack.ts';
    const stackUri = pathToFileURL(stackTs).toString();

    const client = createTestClient({
      readAssembly: (): AssemblyReadResult => ({
        status: 'success',
        data: {
          tree: [{
            path: 'Stack1',
            id: 'Stack1',
            children: [{
              path: 'Stack1/MyBucket/Resource',
              id: 'Resource',
              logicalId: 'MyBucketABC',
              type: 'AWS::S3::Bucket',
              sourceLocation: { file: stackTs, line: 12, column: 5 },
              children: [],
            }],
          }],
        },
      }),
    });

    initializeClient(client, { applicationDir: '/p' });

    const lenses = client.handlers.onCodeLens({
      textDocument: { uri: stackUri },
    });

    expect(lenses).toHaveLength(1);
    expect(lenses[0].range.start.line).toBe(11); // 1-based 12 -> 0-based 11
    expect(lenses[0].command?.title).toContain('AWS::S3::Bucket');
    expect(lenses[0].command?.title).toContain('MyBucketABC');
  });

  test('publishes nothing when assembly is not-found (pre-synth)', () => {
    const client = createTestClient({
      readAssembly: () => ({ status: 'not-found' }),
    });

    initializeClient(client, { applicationDir: '/p' });

    expect(client.published).toHaveLength(0);
  });
});
