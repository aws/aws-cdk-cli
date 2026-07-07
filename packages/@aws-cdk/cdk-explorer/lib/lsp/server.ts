import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import {
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import {
  createConnection,
  CodeLensRefreshRequest,
  ProposedFeatures,
  TextDocumentSyncKind,
  type CodeLens,
  type CodeLensParams,
  type DefinitionParams,
  type DidSaveTextDocumentParams,
  type Diagnostic,
  type ExecuteCommandParams,
  type Hover,
  type HoverParams,
  type InitializeParams,
  type InitializeResult,
  type Location,
  type RemoteConsole,
} from 'vscode-languageserver/node';
/* eslint-disable import/no-relative-packages */
import { codeLensesForFile } from './codelens';
import { executeCommand, SUPPORTED_COMMANDS, type NotifySink } from './commands';
import { mapViolationsToDiagnostics } from './diagnostics';
import { hoverForPosition } from './hover';
import { offsetAtPosition } from './positions';
import { synthFailureDiagnostics } from './synth-diagnostics';
import { sourceTargetAtTemplateOffset } from './template-locator';
import { createIgnoreMatcher } from '../../../toolkit-lib/lib/util/glob-matcher';
import type { AssemblyLock } from '../core/assembly-lock';
import {
  readAssembly as defaultReadAssembly,
  type AssemblyReadResult,
  type ConstructNode,
} from '../core/assembly-reader';
import {
  startAssemblyWatcher as defaultStartAssemblyWatcher,
  type AssemblyWatcher,
  type AssemblyWatcherOptions,
} from '../core/assembly-watcher';
import { SOURCE_WATCH_EXCLUDES } from '../core/synth-runner';
import { isWithinRoot } from '../core/source-resolver';
import type { SynthRunResult } from '../core/synth-runner';

/**
 * The cdk.out watcher fires after a synth's file writes but possibly before the
 * synth releases its write lock. The toolkit's read lock is fail-fast (it does
 * not queue), so refreshFromAssembly polls up to REFRESH_LOCK_RETRIES times,
 * REFRESH_LOCK_RETRY_MS apart, for the write lock to clear before giving up on
 * a refresh pass.
 */
const REFRESH_LOCK_RETRIES = 10;
const REFRESH_LOCK_RETRY_MS = 50;

export interface LspHandlerOptions {
  /** Override readAssembly for tests. Defaults to reading <applicationDir>/cdk.out. */
  readonly readAssembly?: (assemblyDir: string) => Promise<AssemblyReadResult>;
  /** Acquire a read lock on the assembly dir; throws a `LockError` on writer contention. */
  readonly acquireAssemblyLock: (assemblyDir: string) => Promise<AssemblyLock>;
  /**
   * Sink for non-fatal messages. In production, the connection's console writes
   * to the editor's Output panel; in tests, capture into an array.
   */
  readonly logger?: LogSink;
  /** Receives diagnostics ready to be published to the editor. */
  readonly onPublishDiagnostics?: (uri: string, diagnostics: Diagnostic[]) => void;
  /**
   * Invoked after a refresh when new assembly data may have changed CodeLenses,
   * to ask the editor to re-query them. Only called when the client advertised
   * `workspace.codeLens.refreshSupport`.
   */
  readonly onRefreshCodeLenses?: () => void;
  /**
   * Starts the cdk.out watcher. Defaults to the real chokidar-backed watcher;
   * overridden in tests to drive refreshes deterministically.
   */
  readonly startAssemblyWatcher?: (options: AssemblyWatcherOptions) => AssemblyWatcher;
  /**
   * Runs a synth of the project at the given root and returns its typed outcome.
   * Injected by startServer (built from the toolkit bindings); omitted in tests
   * that don't exercise synth. The runner reads `cdk.json` under the passed root
   * on each call and returns `unavailable` when there is no `app`, so
   * availability is decided per synth, not cached here.
   */
  readonly synthRunner?: (projectDir: string) => Promise<SynthRunResult>;
  /** User-facing notification sink. Injected by startServer; omitted in tests. */
  readonly notify?: NotifySink;
}

/**
 * The Toolkit-backed operations the handlers need, built from one Toolkit wired
 * to the editor Output panel. The read lock comes from the Toolkit's own
 * `fromAssemblyDirectory().produce()`, so the LSP never imports `RWLock`.
 */
export interface ToolkitBindings {
  readonly synthRunner: (projectDir: string) => Promise<SynthRunResult>;
  readonly acquireAssemblyLock: (assemblyDir: string) => Promise<AssemblyLock>;
}

export type ToolkitBindingsFactory = (console: RemoteConsole) => ToolkitBindings;

export interface LspServerOptions {
  readonly readable: NodeJS.ReadableStream;
  readonly writable: NodeJS.WritableStream;
  /** Builds the Toolkit-backed bindings once `connection.console` exists. Required; main.ts always wires it. */
  readonly toolkitBindingsFactory: ToolkitBindingsFactory;
}

/** Pure handler functions for LSP messages, extracted for direct unit testing. */
export interface LspHandlers {
  onInitialize(params: InitializeParams): InitializeResult;
  onInitialized(): Promise<void>;
  onDidSaveTextDocument(params: DidSaveTextDocumentParams): void;
  onCodeLens(params: CodeLensParams): Promise<CodeLens[]>;
  onDefinition(params: DefinitionParams): Promise<Location | undefined>;
  onExecuteCommand(params: ExecuteCommandParams): Promise<void>;
  onHover(params: HoverParams): Promise<Hover | undefined>;
  onShutdown(): void;
}

interface LogSink {
  warn(message: string): void;
  error(message: string): void;
}

const NOOP_LOGGER: LogSink = {
  warn: () => {
  },
  error: () => {
  },
};

/** Log auto-synth-on-save outcomes. Errors go to the Output panel; success is silent. */
function handleSynthOnSave(result: SynthRunResult, log: LogSink): void {
  switch (result.status) {
    case 'success':
    case 'lock-conflict':
    case 'unavailable':
      return; // silent — watcher handles updates; lock = another synth running; unavailable = no app
    case 'app-failure':
      log.error(`Auto-synth failed: ${result.message}`);
      return;
    case 'error':
      log.error(`Auto-synth failed unexpectedly: ${result.message}`);
      return;
  }
}

/**
 * Build the LSP message handlers as plain functions over closed-over state.
 * No streams, no JSON-RPC, no framework — testable in isolation.
 */
export function createLspHandlers(options: LspHandlerOptions): LspHandlers {
  const readAssembly = options.readAssembly ?? defaultReadAssembly;
  const acquireAssemblyLock = options.acquireAssemblyLock;
  const log = options.logger ?? NOOP_LOGGER;
  const onPublishDiagnostics = options.onPublishDiagnostics ?? (() => {
  });
  const onRefreshCodeLenses = options.onRefreshCodeLenses ?? (() => {
  });
  const startWatcher = options.startAssemblyWatcher ?? defaultStartAssemblyWatcher;
  const synthRunner = options.synthRunner;
  const notify = options.notify ?? {
    info: () => {
    },
    error: () => {
    },
    withProgress: <T>(_msg: string, fn: () => Promise<T>) => fn(),
  };

  let applicationDir: string | undefined;
  let shutdownRequested = false;
  let synthInFlight = false;
  // URIs (source files, or cdk.json) currently showing synth-failure diagnostics.
  let synthFailureUris = new Set<string>();
  let autoSynthEnabled = false; // off by default; user enables via the CodeLens toggle
  let shouldIgnore: (filePath: string) => boolean = () => false;
  let assemblyWatcher: AssemblyWatcher | undefined;
  // Latest index from readAssembly, served to CodeLens. Refreshed at startup
  // and whenever the cdk.out watcher detects a re-synth.
  let cachedIndex: ConstructIndex<ConstructNode> = ConstructIndex.fromTree<ConstructNode>([]);
  // URIs that currently have published diagnostics. On each refresh we publish
  // an empty array for any URI that no longer has diagnostics, otherwise a
  // resolved violation would leave a stale squiggle behind.
  let publishedUris = new Set<string>();
  // Whether the client supports a server-initiated CodeLens refresh. Captured
  // at initialize; if false we skip the refresh request and lenses update on
  // the editor's next natural re-query.
  let codeLensRefreshSupported = false;

  // Single source of truth for the project root: the directory the client opened
  // (applicationDir from initialize), falling back to cwd for non-IDE callers.
  // Every consumer (assembly read, watcher, synth, diagnostics) reads this so
  // they never disagree about which project is being operated on.
  function currentProjectDir(): string {
    return applicationDir ?? process.cwd();
  }

  async function refreshFromAssembly(projectDir: string): Promise<void> {
    const assemblyDir = path.join(projectDir, 'cdk.out');

    // Hold a read lock so a concurrent synth can't overwrite cdk.out mid-read.
    // The lock is fail-fast, so poll until the writer releases; the file events
    // that triggered us are already over.
    let lock: AssemblyLock | undefined;
    for (let attempt = 0; attempt <= REFRESH_LOCK_RETRIES; attempt++) {
      try {
        lock = await acquireAssemblyLock(assemblyDir);
        break;
      } catch (err) {
        if (ToolkitError.isLockError(err)) {
          if (attempt < REFRESH_LOCK_RETRIES) {
            await new Promise<void>((resolve) => setTimeout(resolve, REFRESH_LOCK_RETRY_MS));
          }
          continue;
        }
        // ENOENT (no cdk.out yet) is expected and silent; anything else is real.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          log.error(`Failed to open cloud assembly for reading: ${(err as Error).message}`);
        }
        return;
      }
    }
    // Write lock still held after every retry: skip this pass.
    if (lock === undefined) return;

    let result: AssemblyReadResult;
    try {
      result = await readAssembly(assemblyDir);
    } finally {
      await lock.release();
    }

    if (result.status === 'error') {
      log.error(`Failed to read cloud assembly: ${result.message}`);
      return;
    }
    if (result.status === 'not-found') return;

    const { tree, violations, warnings } = result.data;
    for (const warning of warnings) {
      log.warn(warning);
    }

    cachedIndex = ConstructIndex.fromTree(tree);

    const { byUri, dropped } = mapViolationsToDiagnostics(violations, cachedIndex);

    for (const drop of dropped) {
      log.warn(`Dropped diagnostic for '${drop.ruleName}' at '${drop.constructPath}': ${drop.reason}`);
    }
    const nextUris = new Set(byUri.keys());
    // Clear diagnostics for files that had violations on the previous refresh
    // but no longer do, so resolved violations disappear from the editor.
    for (const uri of publishedUris) {
      if (!nextUris.has(uri)) {
        onPublishDiagnostics(uri, []);
      }
    }
    for (const [uri, diagnostics] of byUri) {
      onPublishDiagnostics(uri, diagnostics);
    }
    publishedUris = nextUris;

    // New assembly data may change lens titles or positions; ask the editor to
    // re-query CodeLenses (it serves them from the now-updated cachedIndex).
    if (codeLensRefreshSupported) {
      onRefreshCodeLenses();
    }
  }

  // Shared synth invocation used by both the manual CodeLens command and
  // auto-synth-on-save. The in-flight latch suppresses overlapping synths from
  // the same LSP instance: a second call while the first is running is dropped
  // (not queued) and returns lock-conflict immediately. The Toolkit's RWLock
  // would reject it anyway, but this short-circuits before any setup work.
  async function guardedSynth(): Promise<SynthRunResult> {
    if (synthInFlight) return { status: 'lock-conflict' };
    synthInFlight = true;
    try {
      const result = await (synthRunner ? synthRunner(currentProjectDir()) : Promise.resolve({ status: 'error', message: 'No synth runner configured' } as const));
      publishSynthDiagnostics(result);
      return result;
    } finally {
      synthInFlight = false;
    }
  }

  // Publish diagnostics for a failed synth (one per failing source file, or
  // cdk.json as a fallback) and clear them once a synth succeeds. The cdk.out
  // watcher owns violation diagnostics; this only manages synth-failure ones.
  function publishSynthDiagnostics(result: SynthRunResult): void {
    // A successful synth resolves all failures; 'unavailable' means there is no
    // app to fail, so any prior synth-failure diagnostics no longer apply.
    if (result.status === 'success' || result.status === 'unavailable') {
      clearSynthFailures();
      return;
    }
    const failures = synthFailureDiagnostics(result, currentProjectDir());
    if (failures.length === 0) return; // lock-conflict / error: leave any existing diagnostic
    const nextUris = new Set(failures.map((f) => f.uri));
    for (const uri of synthFailureUris) {
      if (!nextUris.has(uri)) onPublishDiagnostics(uri, []);
    }
    for (const f of failures) {
      onPublishDiagnostics(f.uri, f.diagnostics);
    }
    synthFailureUris = nextUris;
  }

  function clearSynthFailures(): void {
    for (const uri of synthFailureUris) {
      onPublishDiagnostics(uri, []);
    }
    synthFailureUris = new Set();
  }

  return {
    onInitialize(params) {
      applicationDir = params.initializationOptions?.applicationDir;
      codeLensRefreshSupported = params.capabilities.workspace?.codeLens?.refreshSupport ?? false;
      return {
        capabilities: {
          textDocumentSync: {
            openClose: false,
            // No keystroke-level edits needed yet. Upgrade to Incremental when
            // we need didChange to mark diagnostics as stale on edit.
            change: TextDocumentSyncKind.None,
            save: { includeText: false },
          },
          // Lens title is computed up-front; no resolve round-trip needed.
          codeLensProvider: { resolveProvider: false },
          // Go-to-definition from a synthesized template back to construct source.
          definitionProvider: true,
          executeCommandProvider: { commands: [...SUPPORTED_COMMANDS] },
          // Hover a construct's creation line to see its resolved CFN properties.
          hoverProvider: true,
        },
      };
    },
    async onInitialized() {
      const projectDir = currentProjectDir();
      // Ignore non-source files (build output, deps, dotfiles). This exclude
      // policy is shared with the web source watcher; see lib/core/source-watch.
      shouldIgnore = createIgnoreMatcher({
        exclude: SOURCE_WATCH_EXCLUDES,
        rootDir: projectDir,
      });
      await refreshFromAssembly(projectDir);

      // Watch cdk.out so any synth (an external `cdk synth`/`cdk watch`, or a
      // future in-process synth) refreshes the editor's diagnostics and lenses.
      assemblyWatcher = startWatcher({
        assemblyDir: path.join(projectDir, 'cdk.out'),
        onChange: () => {
          // refreshFromAssembly is async; surface a rejection rather than
          // floating the promise from this watcher callback.
          refreshFromAssembly(projectDir).catch((err) =>
            log.error(`Assembly refresh failed: ${(err as Error).message}`));
        },
        onError: (err) => log.error(`Assembly watcher error: ${(err as Error).message}`),
      });
    },
    onDidSaveTextDocument(params) {
      if (shutdownRequested) return;
      const filePath = fileURLToPath(params.textDocument.uri);
      if (shouldIgnore(filePath)) return;
      if (!autoSynthEnabled) return;
      void guardedSynth()
        .then((result) => handleSynthOnSave(result, log))
        .catch((err: unknown) => log.error(`Auto-synth threw unexpectedly: ${(err as Error).message}`));
    },
    onCodeLens(params) {
      return codeLensesForFile(cachedIndex, params.textDocument.uri, autoSynthEnabled);
    },
    async onDefinition(params) {
      // Only synthesized templates link back to source, and only file: URIs are
      // readable. Check the scheme before fileURLToPath, which throws on other
      // schemes (untitled:, git:, diff views).
      const uri = params.textDocument.uri;
      if (!uri.startsWith('file:') || !uri.endsWith('.template.json')) {
        return undefined;
      }
      const filePath = fileURLToPath(uri);
      // Bound the client-supplied path to this project's cdk.out before reading.
      if (!(await isWithinRoot(path.join(currentProjectDir(), 'cdk.out'), filePath))) {
        return undefined;
      }
      let templateText: string;
      try {
        templateText = await fs.promises.readFile(filePath, 'utf-8');
      } catch {
        return undefined;
      }
      // Offsets come from current disk text; the owner is looked up in the index
      // built at startup. If the template was re-synthesized since, a missing
      // match degrades to undefined rather than navigating to the wrong place.
      const offset = offsetAtPosition(templateText, params.position);
      return sourceTargetAtTemplateOffset(cachedIndex, filePath, templateText, offset);
    },
    async onExecuteCommand(params) {
      await executeCommand(params.command, params.arguments ?? [], {
        synth: guardedSynth,
        toggleAutoSynth: (enabled) => {
          autoSynthEnabled = enabled;
          onRefreshCodeLenses();
        },
        notify,
      });
    },
    onHover(params) {
      return hoverForPosition(cachedIndex, params.textDocument.uri, params.position,
        (file) => fs.promises.readFile(file, 'utf-8').catch(() => undefined));
    },
    onShutdown() {
      shutdownRequested = true;
      void assemblyWatcher?.close();
      assemblyWatcher = undefined;
    },
  };
}

export function startServer(options: LspServerOptions): void {
  const connection = createConnection(
    ProposedFeatures.all,
    new StreamMessageReader(options.readable),
    new StreamMessageWriter(options.writable),
  );

  // Captured from onInitialize; used to gate CodeLens refresh requests.
  let codeLensRefreshSupported = false;

  // Build the toolkit bindings once connection.console exists; main.ts owns how
  // they are constructed (synth runner + assembly read lock).
  const { synthRunner, acquireAssemblyLock } = options.toolkitBindingsFactory(connection.console);

  const handlers = createLspHandlers({
    logger: connection.console,
    onPublishDiagnostics: (uri, diagnostics) => {
      void connection.sendDiagnostics({ uri, diagnostics });
    },
    onRefreshCodeLenses: () => {
      // codeLensRefreshSupported is captured from onInitialize; gate here so
      // the toggle and the watcher both respect the client's capability.
      if (codeLensRefreshSupported) {
        void connection.sendRequest(CodeLensRefreshRequest.type);
      }
    },
    synthRunner,
    acquireAssemblyLock,
    notify: {
      // Route to the Output panel (connection.console) rather than popups.
      // showMessage creates a dismissable toast that interrupts the user's
      // workflow; console writes are visible on demand in the Output panel.
      info: (msg) => {
        connection.console.info(msg);
      },
      error: (msg) => {
        connection.console.error(msg);
      },
      withProgress: async (title, fn) => {
        const progress = await connection.window.createWorkDoneProgress();
        progress.begin(title);
        try {
          return await fn();
        } finally {
          progress.done();
        }
      },
    },
  });

  connection.onInitialize((params) => {
    codeLensRefreshSupported = params.capabilities.workspace?.codeLens?.refreshSupport ?? false;
    return handlers.onInitialize(params);
  });
  connection.onInitialized(() => {
    // `initialized` is a notification, so nothing awaits us, but onInitialized's
    // async work can still reject. Surface it to the editor Output panel rather
    // than leaving an unhandled rejection.
    handlers.onInitialized().catch((err) => {
      connection.console.error(`onInitialized failed: ${(err as Error).message}`);
    });
  });
  connection.onDidSaveTextDocument((params) => handlers.onDidSaveTextDocument(params));
  connection.onCodeLens((params) => handlers.onCodeLens(params));
  connection.onDefinition((params) => handlers.onDefinition(params));
  connection.onExecuteCommand((params) => handlers.onExecuteCommand(params));
  connection.onHover((params) => handlers.onHover(params));
  connection.onShutdown(() => handlers.onShutdown());
  connection.onExit(() => process.exit(0));

  connection.listen();
}
