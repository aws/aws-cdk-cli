import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { Diagnostic, InitializeParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { AssemblyReadResult } from '../../lib';
import type { SynthRunResult } from '../../lib/core/synth-runner';
import { COMMAND_SYNTH_NOW, type NotifySink } from '../../lib/lsp/commands';
import { createLspHandlers, type LspHandlerOptions, type LspHandlers } from '../../lib/lsp/server';

function makeNotifySink(): NotifySink & { infoMessages: string[]; errorMessages: string[] } {
  const infoMessages: string[] = [];
  const errorMessages: string[] = [];
  return {
    infoMessages,
    errorMessages,
    info: (msg) => infoMessages.push(msg),
    error: (msg) => errorMessages.push(msg),
    withProgress: async (_msg, fn) => fn(),
  };
}

interface CapturedClient {
  handlers: LspHandlers;
  published: Array<{ uri: string; diagnostics: Diagnostic[] }>;
  log: { warn: jest.Mock; error: jest.Mock };
  refreshCodeLens: jest.Mock;
  watcherClosed: jest.Mock;
  triggerWatcher: () => void;
}

function createTestClient(opts?: Partial<LspHandlerOptions>): CapturedClient {
  const published: Array<{ uri: string; diagnostics: Diagnostic[] }> = [];
  const log = { warn: jest.fn(), error: jest.fn() };
  const refreshCodeLens = jest.fn();
  const watcherClosed = jest.fn();
  let watcherOnChange: (() => void) | undefined;
  const handlers = createLspHandlers({
    readAssembly: opts?.readAssembly ?? (() => ({ status: 'not-found' })),
    synthRunner: opts?.synthRunner,
    notify: opts?.notify,
    logger: log,
    onPublishDiagnostics: (uri, diagnostics) => published.push({ uri, diagnostics }),
    onRefreshCodeLenses: refreshCodeLens,
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

function readAssemblyResolvingAfterFirst(): () => AssemblyReadResult {
  const { tree, violations } = bucketViolationFixtures();
  let call = 0;
  return (): AssemblyReadResult => {
    call += 1;
    return { status: 'success', data: call === 1 ? { warnings: [], tree, violations } : { warnings: [], tree } };
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
        textDocumentSync: { openClose: false, change: 0, save: { includeText: false } },
        codeLensProvider: { resolveProvider: false },
        definitionProvider: true,
      },
    });
  });

  test('didSave triggers auto-synth for non-ignored source files when auto-synth is enabled', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'success' });
    const client = createTestClient({ synthRunner });
    initializeClient(client, { applicationDir: '/tmp/test-project' });

    // Enable auto-synth via the toggle command first
    await client.handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(synthRunner).toHaveBeenCalledTimes(1);
  });

  test('didSave does not trigger synth when auto-synth is disabled (default)', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'success' });
    const client = createTestClient({ synthRunner });
    initializeClient(client, { applicationDir: '/tmp/test-project' });

    // auto-synth is off by default
    client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(synthRunner).not.toHaveBeenCalled();
  });

  test('didSave does not trigger synth for ignored files', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'success' });
    const client = createTestClient({ synthRunner });
    initializeClient(client, { applicationDir: '/tmp/test-project' });
    await client.handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/node_modules/foo/index.ts' },
    });
    client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/cdk.out/tree.json' },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(synthRunner).not.toHaveBeenCalled();
  });

  test('didSave is ignored after shutdown', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'success' });
    const client = createTestClient({ synthRunner });
    initializeClient(client, { applicationDir: '/tmp/test-project' });
    await client.handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    client.handlers.onShutdown();
    client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(synthRunner).not.toHaveBeenCalled();
  });

  test('auto-synth app-failure logs to output panel without throwing', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'app-failure', message: 'compile err' });
    const client = createTestClient({ synthRunner });
    initializeClient(client, { applicationDir: '/tmp/test-project' });
    await client.handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    expect(() => client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(client.log.error).toHaveBeenCalledWith(expect.stringContaining('compile err'));
  });

  test('shutdown completes without error', () => {
    const client = createTestClient();
    initializeClient(client);
    expect(() => client.handlers.onShutdown()).not.toThrow();
  });

  test('publishes diagnostics on initialized when assembly has violations', () => {
    const { tree, violations } = bucketViolationFixtures();
    const client = createTestClient({
      readAssembly: () => ({ status: 'success', data: { warnings: [], tree, violations } }),
    });
    initializeClient(client, { applicationDir: '/p' });
    expect(client.published).toHaveLength(1);
    expect(client.published[0].uri).toContain('stack.ts');
    expect(client.published[0].diagnostics).toHaveLength(1);
  });

  test('responds to codeLens with header + resource lenses for the requested file', () => {
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
    const lenses = client.handlers.onCodeLens({ textDocument: { uri: stackUri } });
    expect(lenses).toHaveLength(3); // 2 header + 1 L1
    expect(lenses[2].range.start.line).toBe(11); // 1-based 12 -> 0-based 11
    expect(lenses[2].command?.title).toBe('Creates AWS::S3::Bucket');
  });

  test('publishes nothing when assembly is not-found (pre-synth)', () => {
    const client = createTestClient({ readAssembly: () => ({ status: 'not-found' }) });
    initializeClient(client, { applicationDir: '/p' });
    expect(client.published).toHaveLength(0);
  });

  test('clears diagnostics for a violation resolved on a later refresh', () => {
    const client = createTestClient({ readAssembly: readAssemblyResolvingAfterFirst() });
    initializeClient(client, { applicationDir: '/p' });
    expect(client.published).toHaveLength(1);
    const violationUri = client.published[0].uri;
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
    initializeClient(client, { applicationDir: '/p' }, { workspace: { codeLens: { refreshSupport: true } } });
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
    initializeClient(client, { applicationDir: '/p' }, { workspace: { codeLens: { refreshSupport: true } } });
    expect(client.published).toHaveLength(1);
    const violationUri = client.published[0].uri;
    expect(client.refreshCodeLens).toHaveBeenCalledTimes(1);
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
      expect(target?.range.start).toEqual({ line: 4, character: 2 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('onDefinition returns undefined for a non-template document', () => {
    const client = createTestClient();
    initializeClient(client, { applicationDir: '/p' });
    expect(client.handlers.onDefinition({
      textDocument: { uri: pathToFileURL('/p/lib/stack.ts').toString() },
      position: { line: 0, character: 0 },
    })).toBeUndefined();
  });

  test('onDefinition returns undefined (does not throw) for a non-file URI', () => {
    const client = createTestClient();
    initializeClient(client, { applicationDir: '/p' });
    expect(client.handlers.onDefinition({
      textDocument: { uri: 'untitled:Untitled-1' },
      position: { line: 0, character: 0 },
    })).toBeUndefined();
  });
});

describe('LSP Server -- executeCommand', () => {
  function createCommandClient(opts: Partial<LspHandlerOptions> = {}): {
    handlers: LspHandlers;
    notify: NotifySink & { infoMessages: string[]; errorMessages: string[] };
  } {
    const notify = makeNotifySink();
    const handlers = createLspHandlers({
      readAssembly: () => ({ status: 'not-found' }),
      notify,
      startAssemblyWatcher: (o) => {
        return {
          close: async () => {
          },
        };
      },
      ...opts,
    });
    handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: {} });
    handlers.onInitialized();
    return { handlers, notify };
  }

  test('onInitialize advertises executeCommandProvider with synthNow', () => {
    const { handlers } = createCommandClient();
    const result = handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: {} });
    expect(result.capabilities.executeCommandProvider?.commands).toEqual(expect.arrayContaining([COMMAND_SYNTH_NOW]));
  });

  test('synthNow without synthAvailable notifies info', async () => {
    const { handlers, notify } = createCommandClient();
    await handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    expect(notify.infoMessages.some((m) => m.includes('unavailable'))).toBe(true);
  });

  test('synthNow with success is silent', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'success' });
    const { handlers, notify } = createCommandClient({ synthRunner });
    await handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    expect(notify.infoMessages).toHaveLength(0);
    expect(notify.errorMessages).toHaveLength(0);
  });

  test('synthNow with app-failure notifies error', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'app-failure', message: 'compile error' });
    const { handlers, notify } = createCommandClient({ synthRunner });
    await handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    expect(notify.errorMessages.some((m) => m.includes('compile error'))).toBe(true);
  });

  test('synthNow in-flight latch: second call coalesces as lock-conflict', async () => {
    let resolveFirst!: () => void;
    const firstSynthDone = new Promise<void>((res) => {
      resolveFirst = res;
    });
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>()
      .mockImplementationOnce(() => firstSynthDone.then(() => ({ status: 'success' } as const)))
      .mockResolvedValue({ status: 'success' });
    const { handlers, notify } = createCommandClient({ synthRunner });

    const first = handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    await handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    resolveFirst();
    await first;

    expect(notify.infoMessages.some((m) => m.includes('in progress'))).toBe(true);
    expect(synthRunner).toHaveBeenCalledTimes(1);
  });

  test('didSave and executeCommand share the same in-flight latch', async () => {
    let resolveFirst!: () => void;
    const firstSynthDone = new Promise<void>((res) => {
      resolveFirst = res;
    });
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>()
      .mockImplementationOnce(() => firstSynthDone.then(() => ({ status: 'success' } as const)))
      .mockResolvedValue({ status: 'success' });
    const notify = makeNotifySink();
    const handlers = createLspHandlers({
      readAssembly: () => ({ status: 'not-found' }),
      synthRunner,
      notify,
      startAssemblyWatcher: () => ({
        close: async () => {
        },
      }),
    });
    handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: { applicationDir: '/p' } });
    handlers.onInitialized();

    // Enable auto-synth so didSave triggers a synth
    await handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    // Start a save-triggered synth (first, holds the latch)
    handlers.onDidSaveTextDocument({ textDocument: { uri: 'file:///p/lib/stack.ts' } });

    // Manual command fires while save-synth is in progress
    await handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    resolveFirst();
    await new Promise((r) => setTimeout(r, 0));

    // The manual command hit the latch → lock-conflict info message
    expect(notify.infoMessages.some((m) => m.includes('in progress'))).toBe(true);
    expect(synthRunner).toHaveBeenCalledTimes(1);
  });
});

describe('LSP Server -- auto-synth toggle', () => {
  function createToggleClient(synthAvailable = true) {
    const synthRunner = synthAvailable
      ? jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'success' })
      : undefined;
    const log = { warn: jest.fn(), error: jest.fn() };
    const refreshCodeLens = jest.fn();
    const handlers = createLspHandlers({
      readAssembly: () => ({ status: 'not-found' }),
      synthRunner,
      logger: log,
      onRefreshCodeLenses: refreshCodeLens,
      startAssemblyWatcher: () => ({
        close: async () => {
        },
      }),
    });
    handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: { applicationDir: '/p' } });
    handlers.onInitialized();
    return { handlers, synthRunner, refreshCodeLens, log };
  }

  const stackTs = '/p/lib/stack.ts';
  const stackUri = pathToFileURL(stackTs).toString();
  const treeWithResource = [{
    path: 'Stack1',
    id: 'Stack1',
    children: [{
      path: 'Stack1/R',
      id: 'R',
      logicalId: 'R1',
      type: 'AWS::S3::Bucket',
      sourceLocation: { file: stackTs, line: 5, column: 0 },
      children: [],
    }],
  }];

  test('toggle round-trip: onCodeLens reflects new state after enableAutoSynth', async () => {
    const handlers = createLspHandlers({
      readAssembly: () => ({ status: 'success', data: { warnings: [], tree: treeWithResource } }),
      synthRunner: jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'success' }),
      onRefreshCodeLenses: jest.fn(),
      startAssemblyWatcher: () => ({
        close: async () => {
        },
      }),
    });
    handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: { applicationDir: '/p' } });
    handlers.onInitialized();

    // Before toggle: 2 header lenses (Synth now + Enable auto-synth)
    const before = handlers.onCodeLens({ textDocument: { uri: stackUri } });
    expect(before[0].command?.title).toBe('↻ Synth now');
    expect(before[1].command?.title).toBe('▶ Enable auto-synth');

    // Toggle on
    await handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    // After toggle: 1 header lens (Disable auto-synth)
    const after = handlers.onCodeLens({ textDocument: { uri: stackUri } });
    expect(after[0].command?.title).toBe('⏹ Disable auto-synth');
    expect(after).toHaveLength(2); // 1 header + 1 L1
  });

  test('toggle fires onRefreshCodeLenses', async () => {
    const { handlers, refreshCodeLens } = createToggleClient();
    await handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });
    expect(refreshCodeLens).toHaveBeenCalledTimes(1);
    await handlers.onExecuteCommand({ command: 'cdk.explorer.disableAutoSynth' });
    expect(refreshCodeLens).toHaveBeenCalledTimes(2);
  });

  test('didSave does not trigger synth when synth is unavailable (no runner) even if auto-synth enabled', async () => {
    const { handlers, log } = createToggleClient(false);
    await handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    handlers.onDidSaveTextDocument({ textDocument: { uri: 'file:///p/lib/stack.ts' } });
    await new Promise((r) => setTimeout(r, 0));

    // No runner means the availability gate returns early; we never reach
    // guardedSynth's "No synth runner configured" path, so nothing is logged.
    expect(log.error).not.toHaveBeenCalled();
  });

  test('save-path lock-conflict is silent (no log output)', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'lock-conflict' });
    const log = { warn: jest.fn(), error: jest.fn() };
    const handlers = createLspHandlers({
      readAssembly: () => ({ status: 'not-found' }),
      synthRunner,
      logger: log,
      startAssemblyWatcher: () => ({
        close: async () => {
        },
      }),
    });
    handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: { applicationDir: '/p' } });
    handlers.onInitialized();
    await handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    handlers.onDidSaveTextDocument({ textDocument: { uri: 'file:///p/lib/stack.ts' } });
    await new Promise((r) => setTimeout(r, 0));

    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('save-path error result is logged', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'error', message: 'unexpected failure' });
    const log = { warn: jest.fn(), error: jest.fn() };
    const handlers = createLspHandlers({
      readAssembly: () => ({ status: 'not-found' }),
      synthRunner,
      logger: log,
      startAssemblyWatcher: () => ({
        close: async () => {
        },
      }),
    });
    handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: { applicationDir: '/p' } });
    handlers.onInitialized();
    await handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    handlers.onDidSaveTextDocument({ textDocument: { uri: 'file:///p/lib/stack.ts' } });
    await new Promise((r) => setTimeout(r, 0));

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('unexpected failure'));
  });
});
