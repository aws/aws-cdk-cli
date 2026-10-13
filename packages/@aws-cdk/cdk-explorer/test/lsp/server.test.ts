import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { NonInteractiveIoHost, Toolkit } from '@aws-cdk/toolkit-lib';
import type { Diagnostic, InitializeParams } from 'vscode-languageserver/node';
import type { AssemblyWatcherOptions } from '../../lib/core/assembly-watcher';
import type { SynthRunResult } from '../../lib/core/synth-runner';
import {
  COMMAND_DISABLE_AUTO_SYNTH,
  COMMAND_ENABLE_AUTO_SYNTH,
  COMMAND_SYNTH_NOW,
  type NotifySink,
} from '../../lib/lsp/commands';
import { CDK_LSP_FEATURES, CDK_LSP_PROTOCOL } from '../../lib/lsp/features';
import { createLspHandlers, type LspHandlerOptions, type LspHandlers } from '../../lib/lsp/server';
import { AssemblyFixture, type AssemblySpec } from '../_helpers/assembly';

/**
 * The handlers are driven against a real `Toolkit` over a fixture cloud assembly
 * on disk, so the assembly read path is exercised end to end. Only the things
 * that would reach outside the test are faked: the synth runner (no child
 * process) and the cdk.out watcher (no chokidar, and it fires on demand).
 *
 * The assembly read lock is not exercised here. It lives inside
 * `toolkit.fromAssemblyDirectory().produce()`, so contention and its retries are
 * `@aws-cdk/toolkit-lib`'s contract, tested in that package.
 */
interface TestClient {
  readonly handlers: LspHandlers;
  readonly fixture: AssemblyFixture;
  readonly published: Array<{ uri: string; diagnostics: Diagnostic[] }>;
  readonly log: { warn: jest.Mock; error: jest.Mock };
  readonly notify: NotifySink & { infoMessages: string[]; errorMessages: string[] };
  readonly refreshCodeLens: jest.Mock;
  readonly watcherClosed: jest.Mock;
  readonly watchedDirs: string[];
  /** Fire the cdk.out watcher's onChange. The refresh it starts is fire-and-
   * forget, so callers wait on the effect they expect via {@link waitFor}. */
  triggerWatcher(): void;
  /** URI of an app-relative source file, as the editor would send it. */
  uri(relPath: string): string;
}

function makeNotifySink(): TestClient['notify'] {
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

interface ClientOptions extends Partial<LspHandlerOptions> {
  /** Cloud assembly to build on disk; omit for a project with no assembly. */
  readonly assembly?: AssemblySpec;
}

function createTestClient(opts: ClientOptions = {}): TestClient {
  const { assembly, ...handlerOptions } = opts;
  const fixture = AssemblyFixture.create({
    sourceFiles: { 'lib/stack.ts': '\n'.repeat(30), 'bin/app.ts': '\n'.repeat(10) },
    ...assembly,
  });

  const published: Array<{ uri: string; diagnostics: Diagnostic[] }> = [];
  const log = { warn: jest.fn(), error: jest.fn() };
  const notify = makeNotifySink();
  const refreshCodeLens = jest.fn();
  const watcherClosed = jest.fn();
  const watchedDirs: string[] = [];
  let watcherOnChange: (() => void) | undefined;

  const handlers = createLspHandlers({
    toolkit: new Toolkit({ ioHost: new NonInteractiveIoHost() }),
    logger: log,
    notify,
    onPublishDiagnostics: (uri, diagnostics) => published.push({ uri, diagnostics }),
    onRefreshCodeLenses: refreshCodeLens,
    startAssemblyWatcher: (watchOpts: AssemblyWatcherOptions) => {
      watchedDirs.push(watchOpts.assemblyDir);
      watcherOnChange = watchOpts.onChange;
      return { close: async () => void watcherClosed() };
    },
    ...handlerOptions,
  });

  return {
    handlers,
    fixture,
    published,
    log,
    notify,
    refreshCodeLens,
    watcherClosed,
    watchedDirs,
    triggerWatcher: () => watcherOnChange?.(),
    uri: (relPath) => pathToFileURL(fixture.sourcePath(relPath)).toString(),
  };
}

async function initialize(
  target: TestClient,
  capabilities: InitializeParams['capabilities'] = {},
): Promise<void> {
  target.handlers.onInitialize({
    processId: null,
    capabilities,
    rootUri: null,
    initializationOptions: { applicationDir: target.fixture.appDir },
  });
  await target.handlers.onInitialized();
}

/** Let a fire-and-forget handler settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Poll until `predicate` holds. The watcher's refresh is fire-and-forget and
 * does real I/O, so there is no promise for a test to await.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the assembly refresh to settle');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function synthRunnerReturning(...results: SynthRunResult[]): jest.Mock {
  const runner = jest.fn();
  for (const result of results) {
    runner.mockResolvedValueOnce(result);
  }
  // Repeat the last outcome for any further call.
  runner.mockResolvedValue(results[results.length - 1]);
  return runner;
}

/** An assembly with one bucket created at lib/stack.ts:12:5. */
const ONE_BUCKET: AssemblySpec = {
  stacks: [{
    id: 'Stack1',
    resources: [{ path: 'MyBucket/Resource', logicalId: 'MyBucket123', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' }],
  }],
};

/** The same bucket, plus a violation on it. */
const ONE_BUCKET_WITH_VIOLATION: AssemblySpec = {
  ...ONE_BUCKET,
  reports: [{
    pluginName: 'test-plugin',
    conclusion: 'failure',
    violations: [{
      ruleName: 'no-public-buckets',
      description: 'no public buckets',
      severity: 'error',
      violatingConstructs: [{ constructPath: 'Stack1/MyBucket/Resource' }],
    }],
  }],
};

let clients: TestClient[] = [];

/** Track every client so its fixture is cleaned up. */
function client(opts: ClientOptions = {}): TestClient {
  const tracked = createTestClient(opts);
  clients.push(tracked);
  return tracked;
}

afterEach(() => {
  for (const tracked of clients) {
    tracked.fixture.cleanup();
  }
  clients = [];
});

describe('initialize', () => {
  test('advertises codeLens, definition, hover and save-sync capabilities', async () => {
    const result = client().handlers.onInitialize({
      processId: null, capabilities: {}, rootUri: null, initializationOptions: {},
    });

    expect(result.capabilities.codeLensProvider).toBeDefined();
    expect(result.capabilities.definitionProvider).toBe(true);
    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.textDocumentSync).toMatchObject({ save: { includeText: false } });
  });

  test('advertises the executeCommand provider with every supported command', async () => {
    const result = client().handlers.onInitialize({
      processId: null, capabilities: {}, rootUri: null, initializationOptions: {},
    });

    expect(result.capabilities.executeCommandProvider?.commands).toEqual(
      expect.arrayContaining([COMMAND_SYNTH_NOW, COMMAND_ENABLE_AUTO_SYNTH, COMMAND_DISABLE_AUTO_SYNTH]),
    );
  });

  test('advertises serverInfo and the experimental cdk manifest', async () => {
    const result = client({ version: '2.1.0' }).handlers.onInitialize({
      processId: null, capabilities: {}, rootUri: null, initializationOptions: {},
    });

    expect(result.serverInfo).toMatchObject({ version: '2.1.0' });
    expect((result.capabilities.experimental as any).cdk).toMatchObject({
      protocol: CDK_LSP_PROTOCOL,
      version: '2.1.0',
      features: [...CDK_LSP_FEATURES],
    });
  });

  test('every advertised cdk feature is backed by a real capability', async () => {
    // Guards manifest drift: a feature named here but not implemented would let
    // a client gate on something that silently does nothing.
    const result = client().handlers.onInitialize({
      processId: null, capabilities: {}, rootUri: null, initializationOptions: {},
    });
    const { capabilities } = result;
    const manifest = (capabilities.experimental as any).cdk;

    const backing: Record<string, unknown> = {
      hover: capabilities.hoverProvider,
      codeLens: capabilities.codeLensProvider,
      definition: capabilities.definitionProvider,
      synth: capabilities.executeCommandProvider?.commands.includes(COMMAND_SYNTH_NOW),
      autoSynth: capabilities.executeCommandProvider?.commands.includes(COMMAND_ENABLE_AUTO_SYNTH),
    };
    for (const feature of manifest.features) {
      expect(backing[feature]).toBeTruthy();
    }
  });
});

describe('assembly refresh', () => {
  test('publishes diagnostics for the assembly violations on initialize', async () => {
    const c = client({ assembly: ONE_BUCKET_WITH_VIOLATION });

    await initialize(c);

    expect(c.published).toHaveLength(1);
    expect(c.published[0].uri).toBe(c.uri('lib/stack.ts'));
    expect(c.published[0].diagnostics[0]).toMatchObject({ code: 'no-public-buckets', source: 'test-plugin' });
  });

  test('publishes nothing when the app has not been synthesized', async () => {
    const c = client();
    fs.rmSync(c.fixture.assemblyDir, { recursive: true, force: true });

    await initialize(c);

    expect(c.published).toHaveLength(0);
    expect(c.log.error).not.toHaveBeenCalled();
  });

  test('logs and carries on when the assembly cannot be read', async () => {
    const c = client({ assembly: ONE_BUCKET });
    fs.writeFileSync(path.join(c.fixture.assemblyDir, 'manifest.json'), 'not json{{{');

    await initialize(c);

    expect(c.log.error).toHaveBeenCalledWith(expect.stringContaining('cloud assembly'));
  });

  test('watches the assembly dir resolved from cdk.json, not a hardcoded cdk.out', async () => {
    const c = client({ assembly: ONE_BUCKET });
    fs.renameSync(c.fixture.assemblyDir, path.join(c.fixture.appDir, 'out2'));
    fs.writeFileSync(path.join(c.fixture.appDir, 'cdk.json'), JSON.stringify({ app: 'x', output: 'out2' }));

    await initialize(c);

    expect(c.watchedDirs).toEqual([path.join(c.fixture.appDir, 'out2')]);
  });

  test('reads the assembly from the dir cdk.json points at', async () => {
    const c = client({ assembly: ONE_BUCKET_WITH_VIOLATION });
    fs.renameSync(c.fixture.assemblyDir, path.join(c.fixture.appDir, 'out2'));
    fs.writeFileSync(path.join(c.fixture.appDir, 'cdk.json'), JSON.stringify({ app: 'x', output: 'out2' }));

    await initialize(c);

    // Diagnostics only appear if the assembly was actually found and indexed.
    expect(c.published).toHaveLength(1);
  });

  test('a watcher-detected re-synth refreshes diagnostics', async () => {
    const c = client({ assembly: ONE_BUCKET });
    await initialize(c);
    expect(c.published).toHaveLength(0);

    // The user fixed nothing; a re-synth introduced a violation.
    fs.writeFileSync(
      path.join(c.fixture.assemblyDir, 'validation-report.json'),
      JSON.stringify({ version: '1.0.0', pluginReports: ONE_BUCKET_WITH_VIOLATION.reports }),
    );
    c.triggerWatcher();
    await waitFor(() => c.published.length > 0);

    expect(c.published[0].diagnostics[0].code).toBe('no-public-buckets');
  });

  test('clears a diagnostic for a violation resolved by a later synth', async () => {
    const c = client({ assembly: ONE_BUCKET_WITH_VIOLATION });
    await initialize(c);

    fs.rmSync(path.join(c.fixture.assemblyDir, 'validation-report.json'));
    c.triggerWatcher();
    await waitFor(() => c.published.length > 1);

    // An empty array for the URI, otherwise the squiggle would linger.
    const forFile = c.published.filter((p) => p.uri === c.uri('lib/stack.ts'));
    expect(forFile[forFile.length - 1].diagnostics).toEqual([]);
  });

  test('requests a CodeLens refresh when the client supports it', async () => {
    const c = client({ assembly: ONE_BUCKET });

    await initialize(c, { workspace: { codeLens: { refreshSupport: true } } });

    expect(c.refreshCodeLens).toHaveBeenCalled();
  });

  test('does not request a CodeLens refresh when the client lacks refreshSupport', async () => {
    const c = client({ assembly: ONE_BUCKET });

    await initialize(c, {});

    expect(c.refreshCodeLens).not.toHaveBeenCalled();
  });

  test('closes the watcher on shutdown', async () => {
    const c = client({ assembly: ONE_BUCKET });
    await initialize(c);

    c.handlers.onShutdown();
    await waitFor(() => c.watcherClosed.mock.calls.length > 0);

    expect(c.watcherClosed).toHaveBeenCalled();
  });

  test('shutdown completes without error', async () => {
    const c = client();
    await initialize(c);

    expect(() => c.handlers.onShutdown()).not.toThrow();
  });
});

describe('codeLens', () => {
  test('serves header and resource lenses for the requested file', async () => {
    const c = client({ assembly: ONE_BUCKET });
    await initialize(c);

    const lenses = await c.handlers.onCodeLens({ textDocument: { uri: c.uri('lib/stack.ts') } });

    expect(lenses).toHaveLength(3); // 2 header + 1 resource
    expect(lenses[0].command?.command).toBe(COMMAND_SYNTH_NOW);
    expect(lenses[1].command?.command).toBe(COMMAND_ENABLE_AUTO_SYNTH);
    expect(lenses[2].command?.title).toBe('Creates AWS::S3::Bucket');
  });

  test('serves no lenses for a file with no constructs', async () => {
    const c = client({ assembly: ONE_BUCKET });
    await initialize(c);

    expect(await c.handlers.onCodeLens({ textDocument: { uri: c.uri('bin/app.ts') } })).toEqual([]);
  });

  test('serves no lenses before the app is synthesized', async () => {
    const c = client();
    fs.rmSync(c.fixture.assemblyDir, { recursive: true, force: true });
    await initialize(c);

    expect(await c.handlers.onCodeLens({ textDocument: { uri: c.uri('lib/stack.ts') } })).toEqual([]);
  });
});

describe('onDefinition', () => {
  test('resolves a template position back to the construct source', async () => {
    const c = client({ assembly: ONE_BUCKET });
    await initialize(c);
    const text = c.fixture.templateText('Stack1');
    const typeLine = text.split('\n').findIndex((l) => l.includes('AWS::S3::Bucket'));

    const location = await c.handlers.onDefinition({
      textDocument: { uri: pathToFileURL(c.fixture.templatePath('Stack1')).toString() },
      position: { line: typeLine, character: 2 },
    });

    expect(location).toEqual({
      uri: c.uri('lib/stack.ts'),
      range: { start: { line: 11, character: 4 }, end: { line: 11, character: 4 } },
    });
  });

  test('resolves a template in the dir cdk.json points at', async () => {
    const c = client({ assembly: ONE_BUCKET });
    fs.renameSync(c.fixture.assemblyDir, path.join(c.fixture.appDir, 'out2'));
    fs.writeFileSync(path.join(c.fixture.appDir, 'cdk.json'), JSON.stringify({ app: 'x', output: 'out2' }));
    await initialize(c);
    const templatePath = path.join(c.fixture.appDir, 'out2', 'Stack1.template.json');
    const text = fs.readFileSync(templatePath, 'utf-8');
    const typeLine = text.split('\n').findIndex((l) => l.includes('AWS::S3::Bucket'));

    const location = await c.handlers.onDefinition({
      textDocument: { uri: pathToFileURL(templatePath).toString() },
      position: { line: typeLine, character: 2 },
    });

    expect(location?.uri).toBe(c.uri('lib/stack.ts'));
  });

  test('returns undefined for a document that is not a template', async () => {
    const c = client({ assembly: ONE_BUCKET });
    await initialize(c);

    expect(await c.handlers.onDefinition({
      textDocument: { uri: c.uri('lib/stack.ts') },
      position: { line: 0, character: 0 },
    })).toBeUndefined();
  });

  test('returns undefined for a non-file URI rather than throwing', async () => {
    // An untitled buffer or a diff view; fileURLToPath would throw on these.
    const c = client({ assembly: ONE_BUCKET });
    await initialize(c);

    expect(await c.handlers.onDefinition({
      textDocument: { uri: 'untitled:Untitled-1.template.json' },
      position: { line: 0, character: 0 },
    })).toBeUndefined();
  });

  test('returns undefined for a template outside the project assembly dir', async () => {
    const c = client({ assembly: ONE_BUCKET });
    const other = client({ assembly: ONE_BUCKET });
    await initialize(c);

    expect(await c.handlers.onDefinition({
      textDocument: { uri: pathToFileURL(other.fixture.templatePath('Stack1')).toString() },
      position: { line: 2, character: 2 },
    })).toBeUndefined();
  });
});

describe('onHover', () => {
  test('renders a hover for a construct on the hovered line', async () => {
    const c = client({ assembly: ONE_BUCKET });
    await initialize(c);

    const hover = await c.handlers.onHover({
      textDocument: { uri: c.uri('lib/stack.ts') },
      position: { line: 11, character: 0 },
    });

    expect((hover!.contents as { value: string }).value).toContain('AWS::S3::Bucket');
  });

  test('renders without links and logs when the template has gone missing', async () => {
    // Caught between indexing and the hover, e.g. cdk.out wiped mid-session.
    const c = client({ assembly: ONE_BUCKET });
    await initialize(c);
    fs.rmSync(c.fixture.templatePath('Stack1'));

    const hover = await c.handlers.onHover({
      textDocument: { uri: c.uri('lib/stack.ts') },
      position: { line: 11, character: 0 },
    });

    const value = (hover!.contents as { value: string }).value;
    expect(value).toContain('AWS::S3::Bucket');
    expect(value).not.toContain('](');
    expect(c.log.error).toHaveBeenCalledWith(expect.stringContaining('Stack1.template.json'));
  });

  test('returns undefined for a line with no construct', async () => {
    const c = client({ assembly: ONE_BUCKET });
    await initialize(c);

    expect(await c.handlers.onHover({
      textDocument: { uri: c.uri('lib/stack.ts') },
      position: { line: 28, character: 0 },
    })).toBeUndefined();
  });
});

describe('executeCommand synthNow', () => {
  test('reports an unavailable synth as an info message', async () => {
    const c = client({ synthRunner: synthRunnerReturning({ status: 'unavailable' }) });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    expect(c.notify.infoMessages.some((m) => m.includes('unavailable'))).toBe(true);
  });

  test('is silent on success', async () => {
    const c = client({ synthRunner: synthRunnerReturning({ status: 'success' }) });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    expect(c.notify.infoMessages).toEqual([]);
    expect(c.notify.errorMessages).toEqual([]);
  });

  test('notifies the user of an app failure', async () => {
    const c = client({ synthRunner: synthRunnerReturning({ status: 'app-failure', message: 'compile err' }) });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    expect(c.notify.errorMessages.some((m) => m.includes('compile err'))).toBe(true);
  });

  test('coalesces calls arriving during a synth into one trailing synth', async () => {
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const synthRunner = jest.fn()
      .mockImplementationOnce(() => firstDone.then(() => ({ status: 'success' as const })))
      .mockResolvedValue({ status: 'success' });
    const c = client({ synthRunner });
    await initialize(c);

    const first = c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    // Three more arrive while the first is in flight.
    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    expect(synthRunner).toHaveBeenCalledTimes(1);

    releaseFirst();
    await first;
    await settle();

    // The three collapse into a single follow-up, so the assembly catches up to
    // the latest request without running three synths.
    expect(synthRunner).toHaveBeenCalledTimes(2);
    expect(c.notify.infoMessages.some((m) => m.includes('in progress'))).toBe(true);
  });

  test('shares one latch with the save path', async () => {
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const synthRunner = jest.fn()
      .mockImplementationOnce(() => firstDone.then(() => ({ status: 'success' as const })))
      .mockResolvedValue({ status: 'success' });
    const c = client({ synthRunner });
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });

    // A save starts a synth, then a manual command arrives mid-flight.
    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri('lib/stack.ts') } });
    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    releaseFirst();
    await settle();

    expect(c.notify.infoMessages.some((m) => m.includes('in progress'))).toBe(true);
    expect(synthRunner).toHaveBeenCalledTimes(2);
  });

  test('retries with backoff while an external writer holds the lock', async () => {
    jest.useFakeTimers();
    try {
      // A terminal `cdk synth` holds cdk.out for the first three attempts.
      const synthRunner = synthRunnerReturning(
        { status: 'lock-conflict' },
        { status: 'lock-conflict' },
        { status: 'lock-conflict' },
        { status: 'success' },
      );
      const c = client({ synthRunner });
      await initialize(c);

      const done = c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
      await jest.runAllTimersAsync();
      await done;

      // Retried rather than dropping the user's synth.
      expect(synthRunner).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('auto-synth on save', () => {
  test('synths a saved source file once auto-synth is enabled', async () => {
    const synthRunner = synthRunnerReturning({ status: 'success' });
    const c = client({ synthRunner });
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });

    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri('lib/stack.ts') } });
    await settle();

    expect(synthRunner).toHaveBeenCalledTimes(1);
  });

  test('does not synth while auto-synth is disabled, which is the default', async () => {
    const synthRunner = synthRunnerReturning({ status: 'success' });
    const c = client({ synthRunner });
    await initialize(c);

    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri('lib/stack.ts') } });
    await settle();

    expect(synthRunner).not.toHaveBeenCalled();
  });

  test.each([
    ['a dependency', 'node_modules/foo/index.ts'],
    ['the assembly itself', 'cdk.out/tree.json'],
  ])('does not synth when the saved file is %s', async (_what, relPath) => {
    const synthRunner = synthRunnerReturning({ status: 'success' });
    const c = client({ synthRunner });
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });

    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri(relPath) } });
    await settle();

    expect(synthRunner).not.toHaveBeenCalled();
  });

  test('ignores a save after shutdown', async () => {
    const synthRunner = synthRunnerReturning({ status: 'success' });
    const c = client({ synthRunner });
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });

    c.handlers.onShutdown();
    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri('lib/stack.ts') } });
    await settle();

    expect(synthRunner).not.toHaveBeenCalled();
  });

  test.each([
    ['an app failure', { status: 'app-failure', message: 'compile err' } as SynthRunResult, 'compile err'],
    ['an unexpected error', { status: 'error', message: 'boom' } as SynthRunResult, 'boom'],
  ])('logs %s to the output panel without throwing', async (_what, result, expected) => {
    const c = client({ synthRunner: synthRunnerReturning(result) });
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });

    expect(() => c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri('lib/stack.ts') } })).not.toThrow();
    await settle();

    expect(c.log.error).toHaveBeenCalledWith(expect.stringContaining(expected));
  });

  test('stays silent on the save path when there is no app to synth', async () => {
    // Not the user's problem: nothing is configured to synth.
    const c = client({ synthRunner: synthRunnerReturning({ status: 'unavailable' }) });
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });

    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri('lib/stack.ts') } });
    await settle();

    expect(c.log.error).not.toHaveBeenCalled();
    expect(c.log.warn).not.toHaveBeenCalled();
  });
});

describe('auto-synth toggle', () => {
  test('swaps the header lenses when toggled', async () => {
    const c = client({ assembly: ONE_BUCKET, synthRunner: synthRunnerReturning({ status: 'success' }) });
    await initialize(c);

    const before = await c.handlers.onCodeLens({ textDocument: { uri: c.uri('lib/stack.ts') } });
    expect(before[0].command?.title).toBe('↻ Synth now');
    expect(before[1].command?.title).toBe('▶ Enable auto-synth');

    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });

    const after = await c.handlers.onCodeLens({ textDocument: { uri: c.uri('lib/stack.ts') } });
    expect(after).toHaveLength(2); // 1 header + 1 resource
    expect(after[0].command?.title).toBe('⏹ Disable auto-synth');
  });

  test('asks the editor to re-query lenses on each toggle', async () => {
    const c = client({ synthRunner: synthRunnerReturning({ status: 'success' }) });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });
    expect(c.refreshCodeLens).toHaveBeenCalledTimes(1);

    await c.handlers.onExecuteCommand({ command: COMMAND_DISABLE_AUTO_SYNTH });
    expect(c.refreshCodeLens).toHaveBeenCalledTimes(2);
  });

  test('disabling stops saves from synthing', async () => {
    const synthRunner = synthRunnerReturning({ status: 'success' });
    const c = client({ synthRunner });
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });
    await c.handlers.onExecuteCommand({ command: COMMAND_DISABLE_AUTO_SYNTH });

    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri('lib/stack.ts') } });
    await settle();

    expect(synthRunner).not.toHaveBeenCalled();
  });
});

describe('synth-failure diagnostics', () => {
  test('anchors a failure on the source file it names', async () => {
    const c = client({
      synthRunner: synthRunnerReturning({
        status: 'app-failure',
        message: 'Subprocess exited with error 1',
        details: 'lib/stack.ts:12:5 - error TS2322: nope',
      }),
    });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    const onFile = c.published.find((p) => p.uri === c.uri('lib/stack.ts'));
    expect(onFile?.diagnostics).toHaveLength(1);
    expect(onFile?.diagnostics[0].message).toContain('TS2322');
  });

  test('publishes one diagnostic per failing file', async () => {
    const c = client({
      synthRunner: synthRunnerReturning({
        status: 'app-failure',
        message: 'm',
        details: 'lib/stack.ts(1,1): error TS1000: a\nbin/app.ts(2,2): error TS1001: b',
      }),
    });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    expect(c.published.find((p) => p.uri === c.uri('lib/stack.ts'))?.diagnostics).toHaveLength(1);
    expect(c.published.find((p) => p.uri === c.uri('bin/app.ts'))?.diagnostics).toHaveLength(1);
  });

  test('falls back to cdk.json when the failure names no location', async () => {
    const c = client({ synthRunner: synthRunnerReturning({ status: 'app-failure', message: 'context needed' }) });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    const onCdkJson = c.published.find((p) => p.uri === c.uri('cdk.json'));
    expect(onCdkJson?.diagnostics[0].message).toBe('context needed');
  });

  test.each([
    ['a successful synth', { status: 'success' } as SynthRunResult],
    ['an unavailable synth', { status: 'unavailable' } as SynthRunResult],
  ])('clears a prior failure after %s', async (_what, second) => {
    const c = client({
      synthRunner: synthRunnerReturning(
        { status: 'app-failure', message: 'm', details: 'lib/stack.ts:1:1 - error TS1000: x' },
        second,
      ),
    });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    const forFile = c.published.filter((p) => p.uri === c.uri('lib/stack.ts'));
    expect(forFile[forFile.length - 1].diagnostics).toEqual([]);
  });
});

describe('getConstructTree', () => {
  test('flattens the tree in pre-order with resolved source locations', async () => {
    const c = client({ assembly: ONE_BUCKET });
    await initialize(c);

    const result = await c.handlers.onGetConstructTree();

    expect(result.status).toBe('ok');
    expect(result.assemblyDir).toBe(c.fixture.assemblyDir);
    // Parent before child.
    expect(result.entries.map((e) => e.path)).toEqual(['Stack1', 'Stack1/MyBucket', 'Stack1/MyBucket/Resource']);
    expect(result.entries.find((e) => e.path === 'Stack1/MyBucket/Resource')).toMatchObject({
      id: 'Resource',
      type: 'AWS::S3::Bucket',
      logicalId: 'MyBucket123',
      // This is the LSP's wire format for an external client (the AWS Toolkit
      // tree), so paths are absolute and directly openable — unlike the web
      // protocol, which relativizes to the app dir.
      sourceLocation: { file: c.fixture.sourcePath('lib/stack.ts'), line: 12, column: 5 },
      templateFile: c.fixture.templatePath('Stack1'),
    });
  });

  test('carries the template offset of each resource block', async () => {
    const c = client({ assembly: ONE_BUCKET });
    await initialize(c);
    const text = c.fixture.templateText('Stack1');

    const result = await c.handlers.onGetConstructTree();
    const resource = result.entries.find((e) => e.path === 'Stack1/MyBucket/Resource')!;

    // The offset is the start of the resource's value block, so a client can
    // open the template positioned on it.
    expect(resource.templateOffset).toBe(text.indexOf('{', text.indexOf('"MyBucket123"')));
    expect(text[resource.templateOffset!]).toBe('{');
  });

  test('reports no-assembly before the app is synthesized', async () => {
    const c = client();
    fs.rmSync(c.fixture.assemblyDir, { recursive: true, force: true });
    await initialize(c);

    const result = await c.handlers.onGetConstructTree();

    expect(result.status).toBe('no-assembly');
    expect(result.entries).toEqual([]);
  });
});
