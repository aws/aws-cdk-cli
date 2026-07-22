import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { LockError } from '@aws-cdk/toolkit-lib';
import type { Diagnostic, InitializeParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { AssemblyReadResult } from '../../lib';
import type { AssemblyLock } from '../../lib/core/assembly-lock';
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

/** Simple no-op assembly lock for tests that do not exercise lock contention. */
const mockAssemblyLock = async (): Promise<AssemblyLock> => ({
  release: async () => {
  },
});

interface CapturedClient {
  handlers: LspHandlers;
  published: Array<{ uri: string; diagnostics: Diagnostic[] }>;
  log: { warn: jest.Mock; error: jest.Mock };
  refreshCodeLens: jest.Mock;
  watcherClosed: jest.Mock;
  /** Fire the cdk.out watcher's onChange and await the refresh it triggers. */
  triggerWatcher: () => Promise<void>;
}

function createTestClient(opts?: Partial<LspHandlerOptions>): CapturedClient {
  const published: Array<{ uri: string; diagnostics: Diagnostic[] }> = [];
  const log = { warn: jest.fn(), error: jest.fn() };
  const refreshCodeLens = jest.fn();
  const watcherClosed = jest.fn();
  let watcherOnChange: (() => void) | undefined;
  const handlers = createLspHandlers({
    // Default to "no assembly" so tests that don't care about diagnostics
    // don't need a fake fixture. Tests that do care override this.
    readAssembly: opts?.readAssembly ?? (async () => ({ status: 'not-found' })),
    // Fake assembly lock so refreshFromAssembly does not touch the real filesystem.
    acquireAssemblyLock: opts?.acquireAssemblyLock ?? mockAssemblyLock,
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
    triggerWatcher: async () => {
      watcherOnChange?.();
      // onChange kicks off refreshFromAssembly fire-and-forget; let it settle
      // before the test asserts on the published diagnostics.
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

async function initializeClient(
  client: CapturedClient,
  options?: Record<string, unknown>,
  capabilities?: InitializeParams['capabilities'],
): Promise<void> {
  client.handlers.onInitialize({
    processId: null,
    capabilities: capabilities ?? {},
    rootUri: null,
    initializationOptions: options ?? {},
  });
  await client.handlers.onInitialized();
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
function readAssemblyResolvingAfterFirst(): () => Promise<AssemblyReadResult> {
  const { tree, violations } = bucketViolationFixtures();
  let call = 0;
  return async (): Promise<AssemblyReadResult> => {
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
    await initializeClient(client, { applicationDir: '/tmp/test-project' });

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
    await initializeClient(client, { applicationDir: '/tmp/test-project' });

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
    await initializeClient(client, { applicationDir: '/tmp/test-project' });
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
    await initializeClient(client, { applicationDir: '/tmp/test-project' });
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
    await initializeClient(client, { applicationDir: '/tmp/test-project' });
    await client.handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    expect(() => client.handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(client.log.error).toHaveBeenCalledWith(expect.stringContaining('compile err'));
  });

  test('shutdown completes without error', async () => {
    const client = createTestClient();
    await initializeClient(client);
    expect(() => client.handlers.onShutdown()).not.toThrow();
  });

  test('publishes diagnostics on initialized when assembly has violations', async () => {
    const { tree, violations } = bucketViolationFixtures();
    const client = createTestClient({
      readAssembly: async () => ({ status: 'success', data: { warnings: [], tree, violations } }),
    });
    await initializeClient(client, { applicationDir: '/p' });
    expect(client.published).toHaveLength(1);
    expect(client.published[0].uri).toContain('stack.ts');
    expect(client.published[0].diagnostics).toHaveLength(1);
  });

  test('acquires and releases the assembly lock around the assembly read', async () => {
    const { tree, violations } = bucketViolationFixtures();
    const release = jest.fn(async () => {
    });
    const acquireAssemblyLock = jest.fn(async () => ({ release }));
    const client = createTestClient({
      readAssembly: async () => ({ status: 'success', data: { warnings: [], tree, violations } }),
      acquireAssemblyLock,
    });
    await initializeClient(client, { applicationDir: '/p' });
    expect(acquireAssemblyLock).toHaveBeenCalledWith(path.join('/p', 'cdk.out'));
    expect(release).toHaveBeenCalledTimes(1);
    expect(client.published).toHaveLength(1); // the read happened under the lock
  });

  test('retries while a synth holds the write lock, then skips without error once retries are exhausted', async () => {
    jest.useFakeTimers();
    try {
      const { tree, violations } = bucketViolationFixtures();
      const acquireAssemblyLock = jest.fn(async () => {
        throw new LockError('ConcurrentWriteLock', 'a synth is writing');
      });
      const client = createTestClient({
        readAssembly: async () => ({ status: 'success', data: { warnings: [], tree, violations } }),
        acquireAssemblyLock,
      });
      // onInitialized awaits refreshFromAssembly, which now polls for the lock.
      // Drive the retry delays via fake timers rather than waiting in real time.
      client.handlers.onInitialize({
        processId: null,
        capabilities: {},
        rootUri: null,
        initializationOptions: { applicationDir: '/p' },
      });
      const initialized = client.handlers.onInitialized();
      await jest.runAllTimersAsync();
      await initialized;

      expect(acquireAssemblyLock.mock.calls.length).toBeGreaterThan(1); // it retried
      expect(client.published).toHaveLength(0); // never got the lock, so no read
      expect(client.log.error).not.toHaveBeenCalled(); // contention is not an error
    } finally {
      jest.useRealTimers();
    }
  });

  test('retries the assembly lock on write-lock contention and refreshes once it clears', async () => {
    jest.useFakeTimers();
    try {
      const { tree, violations } = bucketViolationFixtures();
      const release = jest.fn(async () => {
      });
      let calls = 0;
      const acquireAssemblyLock = jest.fn(async () => {
        calls += 1;
        if (calls <= 3) throw new LockError('ConcurrentWriteLock', 'a synth is writing');
        return { release };
      });
      const client = createTestClient({
        readAssembly: async () => ({ status: 'success', data: { warnings: [], tree, violations } }),
        acquireAssemblyLock,
      });
      client.handlers.onInitialize({
        processId: null,
        capabilities: {},
        rootUri: null,
        initializationOptions: { applicationDir: '/p' },
      });
      const initialized = client.handlers.onInitialized();
      await jest.runAllTimersAsync();
      await initialized;

      expect(acquireAssemblyLock).toHaveBeenCalledTimes(4); // 3 contended + 1 success
      expect(release).toHaveBeenCalledTimes(1); // released after the successful read
      expect(client.published).toHaveLength(1); // the violation was published
      expect(client.published[0].diagnostics).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('skips silently when there is no assembly yet (ENOENT)', async () => {
    const { tree, violations } = bucketViolationFixtures();
    const client = createTestClient({
      readAssembly: async () => ({ status: 'success', data: { warnings: [], tree, violations } }),
      acquireAssemblyLock: async () => {
        throw Object.assign(new Error('no cdk.out'), { code: 'ENOENT' });
      },
    });
    await initializeClient(client, { applicationDir: '/p' });
    expect(client.published).toHaveLength(0);
    expect(client.log.error).not.toHaveBeenCalled();
  });

  test('logs and skips on an unexpected lock error', async () => {
    const { tree, violations } = bucketViolationFixtures();
    const client = createTestClient({
      readAssembly: async () => ({ status: 'success', data: { warnings: [], tree, violations } }),
      acquireAssemblyLock: async () => {
        throw new Error('disk on fire');
      },
    });
    await initializeClient(client, { applicationDir: '/p' });
    expect(client.published).toHaveLength(0);
    expect(client.log.error).toHaveBeenCalled();
  });

  test('responds to codeLens with header + resource lenses for the requested file', async () => {
    const stackTs = '/p/lib/stack.ts';
    const stackUri = pathToFileURL(stackTs).toString();
    const client = createTestClient({
      readAssembly: async (): Promise<AssemblyReadResult> => ({
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
    await initializeClient(client, { applicationDir: '/p' });
    const lenses = await client.handlers.onCodeLens({ textDocument: { uri: stackUri } });
    expect(lenses).toHaveLength(3); // 2 header + 1 L1
    expect(lenses[2].range.start.line).toBe(11); // 1-based 12 -> 0-based 11
    expect(lenses[2].command?.title).toBe('Creates AWS::S3::Bucket');
  });

  test('publishes nothing when assembly is not-found (pre-synth)', async () => {
    const client = createTestClient({ readAssembly: async () => ({ status: 'not-found' }) });
    await initializeClient(client, { applicationDir: '/p' });
    expect(client.published).toHaveLength(0);
  });

  test('clears diagnostics for a violation resolved on a later refresh', async () => {
    const client = createTestClient({ readAssembly: readAssemblyResolvingAfterFirst() });
    await initializeClient(client, { applicationDir: '/p' });
    expect(client.published).toHaveLength(1);
    const violationUri = client.published[0].uri;
    expect(client.published[0].diagnostics).toHaveLength(1);

    // Simulate a re-synth picked up by the cdk.out watcher.
    await client.triggerWatcher();

    expect(client.published).toHaveLength(2);
    expect(client.published[1]).toEqual({ uri: violationUri, diagnostics: [] });
  });

  test('requests a CodeLens refresh after a refresh when the client supports it', async () => {
    const client = createTestClient({
      readAssembly: async (): Promise<AssemblyReadResult> => ({
        status: 'success',
        data: { warnings: [], tree: [{ path: 'Stack1', id: 'Stack1', children: [] }] },
      }),
    });
    await initializeClient(client, { applicationDir: '/p' }, { workspace: { codeLens: { refreshSupport: true } } });
    expect(client.refreshCodeLens).toHaveBeenCalledTimes(1);
  });

  test('does not request a CodeLens refresh when the client lacks refreshSupport', async () => {
    const client = createTestClient({
      readAssembly: async (): Promise<AssemblyReadResult> => ({
        status: 'success',
        data: { warnings: [], tree: [{ path: 'Stack1', id: 'Stack1', children: [] }] },
      }),
    });
    await initializeClient(client, { applicationDir: '/p' });
    expect(client.refreshCodeLens).not.toHaveBeenCalled();
  });

  test('a watcher-detected re-synth refreshes diagnostics and lenses', async () => {
    const client = createTestClient({ readAssembly: readAssemblyResolvingAfterFirst() });
    await initializeClient(client, { applicationDir: '/p' }, { workspace: { codeLens: { refreshSupport: true } } });
    expect(client.published).toHaveLength(1);
    const violationUri = client.published[0].uri;
    expect(client.refreshCodeLens).toHaveBeenCalledTimes(1);

    // Simulate a re-synth picked up by the cdk.out watcher.
    await client.triggerWatcher();

    expect(client.published).toHaveLength(2);
    expect(client.published[1]).toEqual({ uri: violationUri, diagnostics: [] });
    expect(client.refreshCodeLens).toHaveBeenCalledTimes(2);
  });

  test('closes the cdk.out watcher on shutdown', async () => {
    const client = createTestClient();
    await initializeClient(client, { applicationDir: '/p' });
    client.handlers.onShutdown();
    expect(client.watcherClosed).toHaveBeenCalledTimes(1);
  });

  test('onDefinition resolves a template position back to construct source', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-def-'));
    const outDir = path.join(dir, 'cdk.out');
    fs.mkdirSync(outDir, { recursive: true });
    const templateFile = path.join(outDir, 'Stack1.template.json');
    const text = JSON.stringify({ Resources: { MyBucket: { Type: 'AWS::S3::Bucket' } } }, undefined, 1);
    fs.writeFileSync(templateFile, text);
    try {
      const client = createTestClient({
        readAssembly: async () => ({
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
      await initializeClient(client, { applicationDir: dir });
      const uri = pathToFileURL(templateFile).toString();
      const position = TextDocument.create(uri, 'json', 0, text).positionAt(text.indexOf('AWS::S3::Bucket'));
      const target = await client.handlers.onDefinition({ textDocument: { uri }, position });
      expect(target?.uri).toBe(pathToFileURL('/p/lib/stack.ts').toString());
      expect(target?.range.start).toEqual({ line: 4, character: 2 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('onDefinition returns undefined for a non-template document', async () => {
    const client = createTestClient();
    await initializeClient(client, { applicationDir: '/p' });
    expect(await client.handlers.onDefinition({
      textDocument: { uri: pathToFileURL('/p/lib/stack.ts').toString() },
      position: { line: 0, character: 0 },
    })).toBeUndefined();
  });

  test('onDefinition returns undefined (does not throw) for a non-file URI', async () => {
    const client = createTestClient();
    await initializeClient(client, { applicationDir: '/p' });
    expect(await client.handlers.onDefinition({
      textDocument: { uri: 'untitled:Untitled-1' },
      position: { line: 0, character: 0 },
    })).toBeUndefined();
  });

  test('onDefinition returns undefined for a template outside the project cdk.out', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'server-def-outside-'));
    const templateFile = path.join(outside, 'Evil.template.json');
    fs.writeFileSync(templateFile, JSON.stringify({ Resources: {} }));
    try {
      const client = createTestClient();
      await initializeClient(client, { applicationDir: '/p' });
      const target = await client.handlers.onDefinition({
        textDocument: { uri: pathToFileURL(templateFile).toString() },
        position: { line: 0, character: 0 },
      });
      expect(target).toBeUndefined();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('LSP Server -- executeCommand', () => {
  function createCommandClient(opts: Partial<LspHandlerOptions> = {}): {
    handlers: LspHandlers;
    notify: NotifySink & { infoMessages: string[]; errorMessages: string[] };
  } {
    const notify = makeNotifySink();
    const handlers = createLspHandlers({
      readAssembly: async () => ({ status: 'not-found' }),
      acquireAssemblyLock: mockAssemblyLock,
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
    void handlers.onInitialized();
    return { handlers, notify };
  }

  test('onInitialize advertises executeCommandProvider with synthNow', () => {
    const { handlers } = createCommandClient();
    const result = handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: {} });
    expect(result.capabilities.executeCommandProvider?.commands).toEqual(expect.arrayContaining([COMMAND_SYNTH_NOW]));
  });

  test('synthNow with no app surfaces an unavailable info message', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, [string]>().mockResolvedValue({ status: 'unavailable' });
    const { handlers, notify } = createCommandClient({ synthRunner });
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

  test('synthNow in-flight latch: second concurrent call is suppressed as lock-conflict', async () => {
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
    // Queue of 1: the coalesced second call is not dropped -- it runs as a
    // trailing synth once the first completes, so synthRunner runs twice.
    expect(synthRunner).toHaveBeenCalledTimes(2);
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
      readAssembly: async () => ({ status: 'not-found' }),
      acquireAssemblyLock: mockAssemblyLock,
      synthRunner,
      notify,
      startAssemblyWatcher: () => ({
        close: async () => {
        },
      }),
    });
    handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: { applicationDir: '/p' } });
    void handlers.onInitialized();

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
    // Queue of 1: the coalesced manual command runs as a trailing synth after
    // the save-triggered synth completes, so synthRunner runs twice.
    expect(synthRunner).toHaveBeenCalledTimes(2);
  });

  test('many overlapping calls coalesce into exactly one trailing synth', async () => {
    let resolveFirst!: () => void;
    const firstSynthDone = new Promise<void>((res) => {
      resolveFirst = res;
    });
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>()
      .mockImplementationOnce(() => firstSynthDone.then(() => ({ status: 'success' } as const)))
      .mockResolvedValue({ status: 'success' });
    const { handlers } = createCommandClient({ synthRunner });

    const first = handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    // Several requests arrive while the first synth is in flight.
    await handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    await handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    await handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    expect(synthRunner).toHaveBeenCalledTimes(1);

    resolveFirst();
    await first;

    // The three overlapping calls collapse into a single trailing synth.
    expect(synthRunner).toHaveBeenCalledTimes(2);
  });

  test('retries the synth with backoff until an external write lock frees', async () => {
    jest.useFakeTimers();
    try {
      let calls = 0;
      const synthRunner = jest.fn<Promise<SynthRunResult>, []>(async () => {
        calls += 1;
        // Simulate a terminal `cdk synth` holding the lock for the first 3 tries.
        return calls <= 3 ? { status: 'lock-conflict' } : { status: 'success' };
      });
      const { handlers } = createCommandClient({ synthRunner });

      const done = handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
      await jest.runAllTimersAsync(); // advance through the backoff delays
      await done;

      // Retried through the 3 lock-conflicts rather than dropping the synth.
      expect(synthRunner).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
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
      readAssembly: async () => ({ status: 'not-found' }),
      acquireAssemblyLock: mockAssemblyLock,
      synthRunner,
      logger: log,
      onRefreshCodeLenses: refreshCodeLens,
      startAssemblyWatcher: () => ({
        close: async () => {
        },
      }),
    });
    handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: { applicationDir: '/p' } });
    void handlers.onInitialized();
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
      readAssembly: async () => ({ status: 'success', data: { warnings: [], tree: treeWithResource } }),
      acquireAssemblyLock: mockAssemblyLock,
      synthRunner: jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'success' }),
      onRefreshCodeLenses: jest.fn(),
      startAssemblyWatcher: () => ({
        close: async () => {
        },
      }),
    });
    handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: { applicationDir: '/p' } });
    await handlers.onInitialized();

    // Before toggle: 2 header lenses (Synth now + Enable auto-synth)
    const before = await handlers.onCodeLens({ textDocument: { uri: stackUri } });
    expect(before[0].command?.title).toBe('↻ Synth now');
    expect(before[1].command?.title).toBe('▶ Enable auto-synth');

    // Toggle on
    await handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    // After toggle: 1 header lens (Disable auto-synth)
    const after = await handlers.onCodeLens({ textDocument: { uri: stackUri } });
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

  test('save-path unavailable result is silent (no log output)', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, [string]>().mockResolvedValue({ status: 'unavailable' });
    const log = { warn: jest.fn(), error: jest.fn() };
    const handlers = createLspHandlers({
      readAssembly: async () => ({ status: 'not-found' }),
      acquireAssemblyLock: mockAssemblyLock,
      synthRunner,
      logger: log,
      startAssemblyWatcher: () => ({
        close: async () => {
        },
      }),
    });
    handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: { applicationDir: '/p' } });
    await handlers.onInitialized();
    await handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    handlers.onDidSaveTextDocument({ textDocument: { uri: 'file:///p/lib/stack.ts' } });
    await new Promise((r) => setTimeout(r, 0));

    // With no app the runner returns 'unavailable', a silent no-op on the save
    // path: there is no app to synth, so nothing is reported.
    expect(synthRunner).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('save-path lock-conflict is silent (no log output)', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({ status: 'lock-conflict' });
    const log = { warn: jest.fn(), error: jest.fn() };
    const handlers = createLspHandlers({
      readAssembly: async () => ({ status: 'not-found' }),
      acquireAssemblyLock: mockAssemblyLock,
      synthRunner,
      logger: log,
      startAssemblyWatcher: () => ({
        close: async () => {
        },
      }),
    });
    handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: { applicationDir: '/p' } });
    await handlers.onInitialized();
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
      readAssembly: async () => ({ status: 'not-found' }),
      acquireAssemblyLock: mockAssemblyLock,
      synthRunner,
      logger: log,
      startAssemblyWatcher: () => ({
        close: async () => {
        },
      }),
    });
    handlers.onInitialize({ processId: null, capabilities: {}, rootUri: null, initializationOptions: { applicationDir: '/p' } });
    await handlers.onInitialized();
    await handlers.onExecuteCommand({ command: 'cdk.explorer.enableAutoSynth' });

    handlers.onDidSaveTextDocument({ textDocument: { uri: 'file:///p/lib/stack.ts' } });
    await new Promise((r) => setTimeout(r, 0));

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('unexpected failure'));
  });
});

describe('LSP Server -- synth-failure diagnostics', () => {
  test('app-failure publishes a diagnostic on the failing source file', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({
      status: 'app-failure',
      message: 'Subprocess exited with error 1',
      details: 'lib/stack.ts:12:5 - error TS2322: nope',
    });
    const client = createTestClient({ synthRunner });
    await initializeClient(client, { applicationDir: '/p' });

    await client.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    const onFile = client.published.find((p) => p.uri === pathToFileURL('/p/lib/stack.ts').toString());
    expect(onFile?.diagnostics).toHaveLength(1);
    expect(onFile?.diagnostics[0].message).toContain('TS2322');
  });

  test('publishes a diagnostic per failing file', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({
      status: 'app-failure',
      message: 'm',
      details: 'lib/stack.ts(1,1): error TS1000: a\nbin/app.ts(2,2): error TS1001: b',
    });
    const client = createTestClient({ synthRunner });
    await initializeClient(client, { applicationDir: '/p' });

    await client.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    expect(client.published.find((p) => p.uri === pathToFileURL('/p/lib/stack.ts').toString())?.diagnostics).toHaveLength(1);
    expect(client.published.find((p) => p.uri === pathToFileURL('/p/bin/app.ts').toString())?.diagnostics).toHaveLength(1);
  });

  test('app-failure without a parseable location falls back to cdk.json', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>().mockResolvedValue({
      status: 'app-failure',
      message: 'context needed',
    });
    const client = createTestClient({ synthRunner });
    await initializeClient(client, { applicationDir: '/p' });

    await client.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    const onCdkJson = client.published.find((p) => p.uri === pathToFileURL('/p/cdk.json').toString());
    expect(onCdkJson?.diagnostics[0].message).toBe('context needed');
  });

  test('a successful synth clears a prior synth-failure diagnostic', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, []>()
      .mockResolvedValueOnce({ status: 'app-failure', message: 'm', details: 'lib/stack.ts:1:1 - error TS1000: x' })
      .mockResolvedValueOnce({ status: 'success' });
    const client = createTestClient({ synthRunner });
    await initializeClient(client, { applicationDir: '/p' });

    await client.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    await client.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    const uri = pathToFileURL('/p/lib/stack.ts').toString();
    const entriesForFile = client.published.filter((p) => p.uri === uri);
    expect(entriesForFile[entriesForFile.length - 1].diagnostics).toEqual([]);
  });

  test('an unavailable result clears a prior synth-failure diagnostic', async () => {
    const synthRunner = jest.fn<Promise<SynthRunResult>, [string]>()
      .mockResolvedValueOnce({ status: 'app-failure', message: 'm', details: 'lib/stack.ts:1:1 - error TS1000: x' })
      .mockResolvedValueOnce({ status: 'unavailable' });
    const client = createTestClient({ synthRunner });
    await initializeClient(client, { applicationDir: '/p' });

    await client.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    await client.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    const uri = pathToFileURL('/p/lib/stack.ts').toString();
    const entriesForFile = client.published.filter((p) => p.uri === uri);
    expect(entriesForFile[entriesForFile.length - 1].diagnostics).toEqual([]);
  });
});

describe('getConstructTree request', () => {
  const emptyViolations = { version: '1.0.0', pluginReports: [] };

  it('flattens the source-resolved tree in pre-order', async () => {
    const tree = [
      {
        path: 'Stack1',
        id: 'Stack1',
        children: [
          {
            path: 'Stack1/MyBucket',
            id: 'MyBucket',
            type: 'AWS::S3::Bucket',
            logicalId: 'MyBucket123',
            templateFile: path.join('/p', 'cdk.out', 'Stack1.template.json'),
            sourceLocation: { file: '/p/lib/stack.ts', line: 12, column: 5 },
            children: [],
          },
        ],
      },
    ];
    const client = createTestClient({
      readAssembly: async () => ({ status: 'success', data: { warnings: ['bad source map'], tree, violations: emptyViolations } }),
    });
    await initializeClient(client, { applicationDir: '/p' });

    const result = client.handlers.onGetConstructTree();

    expect(result.status).toBe('ok');
    expect(result.assemblyDir).toBe(path.join('/p', 'cdk.out'));
    expect(result.warnings).toEqual(['bad source map']);
    // Pre-order: parent before child.
    expect(result.entries.map((e) => e.path)).toEqual(['Stack1', 'Stack1/MyBucket']);
    const bucket = result.entries.find((e) => e.path === 'Stack1/MyBucket');
    expect(bucket).toMatchObject({
      id: 'MyBucket',
      type: 'AWS::S3::Bucket',
      logicalId: 'MyBucket123',
      sourceLocation: { file: '/p/lib/stack.ts', line: 12, column: 5 },
      templateFile: path.join('/p', 'cdk.out', 'Stack1.template.json'),
    });
  });

  it('includes the template offset of the resource block', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-tree-'));
    const outDir = path.join(dir, 'cdk.out');
    fs.mkdirSync(outDir, { recursive: true });
    const templateFile = path.join(outDir, 'Stack1.template.json');
    const text = JSON.stringify({ Resources: { MyBucket123: { Type: 'AWS::S3::Bucket' } } }, undefined, 1);
    fs.writeFileSync(templateFile, text);
    try {
      const client = createTestClient({
        readAssembly: async () => ({
          status: 'success',
          data: {
            tree: [{
              path: 'Stack1/MyBucket',
              id: 'MyBucket',
              type: 'AWS::S3::Bucket',
              logicalId: 'MyBucket123',
              templateFile,
              children: [],
            }],
            violations: emptyViolations,
            warnings: [],
          },
        }),
      });
      await initializeClient(client, { applicationDir: dir });

      const result = client.handlers.onGetConstructTree();

      // The offset is the start of the resource's value block: the first `{`
      // after the logical id key.
      const expectedStart = text.indexOf('{', text.indexOf('"MyBucket123"'));
      const bucket = result.entries.find((e) => e.path === 'Stack1/MyBucket');
      expect(bucket?.templateOffset).toBe(expectedStart);
      expect(text[bucket!.templateOffset!]).toBe('{');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports no-assembly before the app is synthesized', async () => {
    const client = createTestClient({ readAssembly: async () => ({ status: 'not-found' }) });
    await initializeClient(client, { applicationDir: '/p' });

    const result = client.handlers.onGetConstructTree();

    expect(result.status).toBe('no-assembly');
    expect(result.entries).toEqual([]);
    expect(result.assemblyDir).toBe(path.join('/p', 'cdk.out'));
  });
});
