import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { Diagnostic, InitializeParams } from 'vscode-languageserver/node';
import type { AssemblyWatcherOptions } from '../../lib/core/assembly-watcher';
import {
  COMMAND_DISABLE_AUTO_SYNTH,
  COMMAND_ENABLE_AUTO_SYNTH,
  COMMAND_SYNTH_NOW,
  type NotifySink,
} from '../../lib/lsp/commands';
import { CDK_LSP_FEATURES, CDK_LSP_PROTOCOL } from '../../lib/lsp/features';
import { createLspHandlers, type LspHandlerOptions, type LspHandlers } from '../../lib/lsp/server';
import { AssemblyFixture, type AssemblySpec } from '../_helpers/assembly';
import { FakeToolkit } from '../_helpers/fake-toolkit';

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
  /** Scripts synth outcomes; the assembly-read path stays real. */
  readonly toolkit: FakeToolkit;
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
  /**
   * Written as the project's `cdk.json`. A synthesizable project needs an `app`,
   * which is what `runSynth` reads to decide there is anything to synth.
   */
  readonly cdkJson?: Record<string, unknown>;
}

function createTestClient(opts: ClientOptions = {}): TestClient {
  const { assembly, cdkJson, ...handlerOptions } = opts;
  const fixture = AssemblyFixture.create({
    sourceFiles: {
      'lib/stack.ts': '\n'.repeat(30),
      'bin/app.ts': '\n'.repeat(10),
      // Default to a synthesizable project; a test can override or omit the app.
      'cdk.json': JSON.stringify(cdkJson ?? { app: 'node bin/app.js' }),
    },
    ...assembly,
  });
  const toolkit = new FakeToolkit();

  const published: Array<{ uri: string; diagnostics: Diagnostic[] }> = [];
  const log = { warn: jest.fn(), error: jest.fn() };
  const notify = makeNotifySink();
  const refreshCodeLens = jest.fn();
  const watcherClosed = jest.fn();
  const watchedDirs: string[] = [];
  let watcherOnChange: (() => void) | undefined;

  const handlers = createLspHandlers({
    toolkit: toolkit.asToolkit(),
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
    toolkit,
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
  test('is silent on a successful synth', async () => {
    const c = client();
    c.toolkit.willSynth({ kind: 'success' });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    expect(c.toolkit.synthCount).toBe(1);
    expect(c.notify.infoMessages).toEqual([]);
    expect(c.notify.errorMessages).toEqual([]);
  });

  test('surfaces a failing app as both a notification and diagnostics', async () => {
    const c = client();
    c.toolkit.willSynth({ kind: 'app-failure', message: 'compile err' });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    // The notification says a synth failed at all; the diagnostics say where
    // (anchored in the synth-failure diagnostics tests below).
    expect(c.notify.errorMessages.some((m) => m.includes('compile err'))).toBe(true);
    expect(c.published.some((pub) => pub.diagnostics.length > 0)).toBe(true);
  });

  test('reports an unexpected failure as an error, with no diagnostics to anchor it', async () => {
    // A full disk, a lock we gave up waiting on, or a dispose failure is not an
    // app problem, so there is no source location to point at. It still has to
    // reach the user, or the synth silently never happened.
    const c = client();
    c.toolkit.willSynth({ kind: 'error', message: 'disk full' });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    expect(c.notify.errorMessages.some((m) => m.includes('disk full'))).toBe(true);
    expect(c.published.every((pub) => pub.diagnostics.length === 0)).toBe(true);
  });

  test('explains a project with no app instead of reporting a failure', async () => {
    // Nothing is configured to synth. That is worth saying out loud, since the
    // command would otherwise look like it did nothing, but it is not an error.
    const c = client({ cdkJson: { context: {} } });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    expect(c.toolkit.synthCount).toBe(0);
    expect(c.notify.infoMessages.some((m) => m.includes('No CDK app'))).toBe(true);
    expect(c.notify.errorMessages).toEqual([]);
    expect(c.log.error).not.toHaveBeenCalled();
    expect(c.published.every((pub) => pub.diagnostics.length === 0)).toBe(true);
  });

  test('coalesces calls arriving during a synth into one trailing synth', async () => {
    const c = client();
    c.toolkit.willSynth({ kind: 'success' }).blockSynth();
    await initialize(c);

    const first = c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    // The synth starts asynchronously (it reads cdk.json first), so wait until it
    // is actually in flight and held open by the gate.
    await waitFor(() => c.toolkit.synthCount === 1);

    // Three more arrive while the first is still in flight.
    const rest = [
      c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW }),
      c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW }),
      c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW }),
    ];
    await settle();
    expect(c.toolkit.synthCount).toBe(1);

    c.toolkit.releaseSynth();
    for (const pending of [first, ...rest]) {
      await pending;
    }

    // The three collapse into a single follow-up, so the assembly catches up to
    // the latest request without running three synths.
    expect(c.toolkit.synthCount).toBe(2);
  });

  test('shares one latch with the save path', async () => {
    const c = client();
    c.toolkit.willSynth({ kind: 'success' }).blockSynth();
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });

    // A save starts a synth, then a manual command arrives mid-flight.
    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri('lib/stack.ts') } });
    await waitFor(() => c.toolkit.synthCount === 1);
    const manual = c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    c.toolkit.releaseSynth();
    await manual;

    // The manual command did not start its own synth alongside the save's.
    expect(c.toolkit.synthCount).toBe(2);
  });

  test('retries while an external writer holds the cdk.out lock', async () => {
    // A terminal `cdk synth` holds the lock for the first three attempts.
    const c = client();
    c.toolkit.willSynth(
      { kind: 'locked' },
      { kind: 'locked' },
      { kind: 'locked' },
      { kind: 'success' },
    );
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    // Retried rather than dropping the user's synth.
    expect(c.toolkit.synthCount).toBe(4);
    expect(c.notify.errorMessages).toEqual([]);
  });
});

describe('auto-synth on save', () => {
  test('synths a saved source file once auto-synth is enabled', async () => {
    const c = client();
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });

    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri('lib/stack.ts') } });
    await waitFor(() => c.toolkit.synthCount === 1);

    expect(c.toolkit.appSynthCalls[0]).toBe(c.fixture.appDir);
  });

  test('does not synth while auto-synth is disabled, which is the default', async () => {
    const c = client();
    await initialize(c);

    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri('lib/stack.ts') } });
    await settle();

    expect(c.toolkit.synthCount).toBe(0);
  });

  test.each([
    ['a dependency', 'node_modules/foo/index.ts'],
    ['the assembly itself', 'cdk.out/tree.json'],
  ])('does not synth when the saved file is %s', async (_what, relPath) => {
    const c = client();
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });

    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri(relPath) } });
    await settle();

    expect(c.toolkit.synthCount).toBe(0);
  });

  test('ignores a save after shutdown', async () => {
    const c = client();
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });

    c.handlers.onShutdown();
    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri('lib/stack.ts') } });
    await settle();

    expect(c.toolkit.synthCount).toBe(0);
  });

  test('stays silent on the save path when there is no app to synth', async () => {
    // Not the user's problem: nothing is configured to synth.
    const c = client({ cdkJson: { context: {} } });
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
    const c = client({ assembly: ONE_BUCKET });
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
    const c = client();
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });
    expect(c.refreshCodeLens).toHaveBeenCalledTimes(1);

    await c.handlers.onExecuteCommand({ command: COMMAND_DISABLE_AUTO_SYNTH });
    expect(c.refreshCodeLens).toHaveBeenCalledTimes(2);
  });

  test('disabling stops saves from synthing', async () => {
    const c = client();
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_ENABLE_AUTO_SYNTH });
    await c.handlers.onExecuteCommand({ command: COMMAND_DISABLE_AUTO_SYNTH });

    c.handlers.onDidSaveTextDocument({ textDocument: { uri: c.uri('lib/stack.ts') } });
    await settle();

    expect(c.toolkit.synthCount).toBe(0);
  });
});

describe('synth-failure diagnostics', () => {
  test('anchors a failure on the source file it names', async () => {
    const c = client();
    c.toolkit.willSynth({
      kind: 'app-failure',
      message: 'Subprocess exited with error 1',
      details: 'lib/stack.ts:12:5 - error TS2322: nope',
    });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    const onFile = c.published.find((pub) => pub.uri === c.uri('lib/stack.ts'));
    expect(onFile?.diagnostics).toHaveLength(1);
    expect(onFile?.diagnostics[0].message).toContain('TS2322');
  });

  test('publishes one diagnostic per failing file', async () => {
    const c = client();
    c.toolkit.willSynth({
      kind: 'app-failure',
      message: 'm',
      details: 'lib/stack.ts(1,1): error TS1000: a\nbin/app.ts(2,2): error TS1001: b',
    });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    expect(c.published.find((pub) => pub.uri === c.uri('lib/stack.ts'))?.diagnostics).toHaveLength(1);
    expect(c.published.find((pub) => pub.uri === c.uri('bin/app.ts'))?.diagnostics).toHaveLength(1);
  });

  test('falls back to cdk.json when the failure names no location', async () => {
    const c = client();
    c.toolkit.willSynth({ kind: 'app-failure', message: 'context needed' });
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    const onCdkJson = c.published.find((pub) => pub.uri === c.uri('cdk.json'));
    expect(onCdkJson?.diagnostics[0].message).toBe('context needed');
  });

  test('clears a prior failure once a synth succeeds', async () => {
    const c = client();
    c.toolkit.willSynth(
      { kind: 'app-failure', message: 'm', details: 'lib/stack.ts:1:1 - error TS1000: x' },
      { kind: 'success' },
    );
    await initialize(c);

    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });
    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    const forFile = c.published.filter((pub) => pub.uri === c.uri('lib/stack.ts'));
    expect(forFile[forFile.length - 1].diagnostics).toEqual([]);
  });

  test('clears a prior failure once there is no app left to synth', async () => {
    const c = client();
    c.toolkit.willSynth({ kind: 'app-failure', message: 'm', details: 'lib/stack.ts:1:1 - error TS1000: x' });
    await initialize(c);
    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    // The app command is removed, so the previous failure no longer applies.
    fs.writeFileSync(path.join(c.fixture.appDir, 'cdk.json'), JSON.stringify({ context: {} }));
    await c.handlers.onExecuteCommand({ command: COMMAND_SYNTH_NOW });

    const forFile = c.published.filter((pub) => pub.uri === c.uri('lib/stack.ts'));
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
