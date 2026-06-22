import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { Diagnostic, InitializeParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { AssemblyReadResult } from '../../lib';
import { createLspHandlers, type LspHandlerOptions, type LspHandlers } from '../../lib/lsp/server';

interface CapturedClient {
  handlers: LspHandlers;
  published: Array<{ uri: string; diagnostics: Diagnostic[] }>;
  log: { warn: jest.Mock; error: jest.Mock };
  refreshCodeLens: jest.Mock;
  watcherClosed: jest.Mock;
  /** Fire the cdk.out watcher's onChange, as a real re-synth would. */
  triggerWatcher: () => void;
}

function createTestClient(opts?: Partial<Pick<LspHandlerOptions, 'onSynthRequest' | 'readAssembly'>>): CapturedClient {
  const published: Array<{ uri: string; diagnostics: Diagnostic[] }> = [];
  const log = { warn: jest.fn(), error: jest.fn() };
  const refreshCodeLens = jest.fn();
  const watcherClosed = jest.fn();
  let watcherOnChange: (() => void) | undefined;
  const handlers = createLspHandlers({
    onSynthRequest: opts?.onSynthRequest,
    // Default to "no assembly" so tests that don't care about diagnostics
    // don't need a fake fixture. Tests that do care override this.
    readAssembly: opts?.readAssembly ?? (() => ({ status: 'not-found' })),
    logger: log,
    onPublishDiagnostics: (uri, diagnostics) => published.push({ uri, diagnostics }),
    onRefreshCodeLenses: refreshCodeLens,
    // Inject a fake watcher so unit tests never start a real chokidar instance;
    // capture its onChange so tests can simulate a re-synth deterministically.
    startAssemblyWatcher: (watchOpts) => {
      watcherOnChange = watchOpts.onChange;
      return {
        close: async () => {
          watcherClosed();
        },
      };
    },
  });
  return {
    handlers,
    published,
    log,
    refreshCodeLens,
    watcherClosed,
    triggerWatcher: () => watcherOnChange?.(),
  };
}

function initializeClient(
  client: CapturedClient,
  options?: Record<string, unknown>,
  capabilities?: InitializeParams['capabilities'],
): void {
  client.handlers.onInitialize({
    processId: null,
    capabilities: capabilities ?? {},
    rootUri: null,
    initializationOptions: options ?? {},
  });
  client.handlers.onInitialized();
}

function bucketViolationFixtures() {
  const tree = [{
    path: 'Stack1',
    id: 'Stack1',
    children: [{
      path: 'Stack1/MyBucket',
      id: 'MyBucket',
      children: [],
      sourceLocation: { file: '/p/lib/stack.ts', line: 12, column: 5 },
    }],
  }];
  const violations = {
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
  };
  return { tree, violations };
}

/**
 * A readAssembly that reports a violation on the first read and the same tree
 * with the violation resolved on every read after, simulating a user fixing it
 * and re-synthing.
 */
function readAssemblyResolvingAfterFirst(): () => AssemblyReadResult {
  const { tree, violations } = bucketViolationFixtures();
  let call = 0;
  return (): AssemblyReadResult => {
    call += 1;
    return {
      status: 'success',
      data: call === 1 ? { warnings: [], tree, violations } : { warnings: [], tree },
    };
  };
}

describe('LSP Server', () => {
  test('initialize advertises codeLens, definition, and save-sync capabilities', () => {
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
        definitionProvider: true,
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
    const { tree, violations } = bucketViolationFixtures();
    const client = createTestClient({
      readAssembly: () => ({
        status: 'success',
        data: { warnings: [], tree, violations },
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
          warnings: [],
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
    expect(lenses[0].command?.title).toBe('Creates AWS::S3::Bucket');
  });

  test('publishes nothing when assembly is not-found (pre-synth)', () => {
    const client = createTestClient({
      readAssembly: () => ({ status: 'not-found' }),
    });

    initializeClient(client, { applicationDir: '/p' });

    expect(client.published).toHaveLength(0);
  });

  test('clears diagnostics for a violation resolved on a later refresh', () => {
    const client = createTestClient({ readAssembly: readAssemblyResolvingAfterFirst() });

    initializeClient(client, { applicationDir: '/p' });
    expect(client.published).toHaveLength(1);
    const violationUri = client.published[0].uri;
    expect(client.published[0].diagnostics).toHaveLength(1);

    // Simulate a re-synth picked up by the cdk.out watcher.
    client.triggerWatcher();

    expect(client.published).toHaveLength(2);
    expect(client.published[1]).toEqual({ uri: violationUri, diagnostics: [] });
  });

  test('requests a CodeLens refresh after a refresh when the client supports it', () => {
    const client = createTestClient({
      readAssembly: (): AssemblyReadResult => ({
        status: 'success',
        data: { warnings: [], tree: [{ path: 'Stack1', id: 'Stack1', children: [] }] },
      }),
    });

    initializeClient(client, { applicationDir: '/p' }, {
      workspace: { codeLens: { refreshSupport: true } },
    });

    expect(client.refreshCodeLens).toHaveBeenCalledTimes(1);
  });

  test('does not request a CodeLens refresh when the client lacks refreshSupport', () => {
    const client = createTestClient({
      readAssembly: (): AssemblyReadResult => ({
        status: 'success',
        data: { warnings: [], tree: [{ path: 'Stack1', id: 'Stack1', children: [] }] },
      }),
    });

    initializeClient(client, { applicationDir: '/p' });

    expect(client.refreshCodeLens).not.toHaveBeenCalled();
  });

  test('a watcher-detected re-synth refreshes diagnostics and lenses', () => {
    const client = createTestClient({ readAssembly: readAssemblyResolvingAfterFirst() });

    initializeClient(client, { applicationDir: '/p' }, {
      workspace: { codeLens: { refreshSupport: true } },
    });
    expect(client.published).toHaveLength(1);
    const violationUri = client.published[0].uri;
    expect(client.refreshCodeLens).toHaveBeenCalledTimes(1);

    // Simulate a re-synth picked up by the cdk.out watcher.
    client.triggerWatcher();

    expect(client.published).toHaveLength(2);
    expect(client.published[1]).toEqual({ uri: violationUri, diagnostics: [] });
    expect(client.refreshCodeLens).toHaveBeenCalledTimes(2);
  });

  test('closes the cdk.out watcher on shutdown', () => {
    const client = createTestClient();
    initializeClient(client, { applicationDir: '/p' });

    client.handlers.onShutdown();

    expect(client.watcherClosed).toHaveBeenCalledTimes(1);
  });

  test('onDefinition resolves a template position back to construct source', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-def-'));
    const templateFile = path.join(dir, 'Stack1.template.json');
    const text = JSON.stringify({ Resources: { MyBucket: { Type: 'AWS::S3::Bucket' } } }, undefined, 1);
    fs.writeFileSync(templateFile, text);
    try {
      const client = createTestClient({
        readAssembly: () => ({
          status: 'success',
          data: {
            tree: [{
              path: 'Stack1/MyBucket/Resource',
              id: 'Resource',
              logicalId: 'MyBucket',
              type: 'AWS::S3::Bucket',
              templateFile,
              sourceLocation: { file: '/p/lib/stack.ts', line: 5, column: 3 },
              children: [],
            }],
            violations: [],
            warnings: [],
          },
        }),
      });
      initializeClient(client, { applicationDir: dir });

      const uri = pathToFileURL(templateFile).toString();
      const position = TextDocument.create(uri, 'json', 0, text).positionAt(text.indexOf('AWS::S3::Bucket'));
      const target = client.handlers.onDefinition({ textDocument: { uri }, position });

      expect(target?.uri).toBe(pathToFileURL('/p/lib/stack.ts').toString());
      expect(target?.range.start).toEqual({ line: 4, character: 2 }); // 1-based (5,3) -> 0-based
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('onDefinition returns undefined for a non-template document', () => {
    const client = createTestClient();
    initializeClient(client, { applicationDir: '/p' });
    const target = client.handlers.onDefinition({
      textDocument: { uri: pathToFileURL('/p/lib/stack.ts').toString() },
      position: { line: 0, character: 0 },
    });
    expect(target).toBeUndefined();
  });

  test('onDefinition returns undefined (does not throw) for a non-file URI', () => {
    const client = createTestClient();
    initializeClient(client, { applicationDir: '/p' });
    expect(
      client.handlers.onDefinition({
        textDocument: { uri: 'untitled:Untitled-1' },
        position: { line: 0, character: 0 },
      }),
    ).toBeUndefined();
  });
});
