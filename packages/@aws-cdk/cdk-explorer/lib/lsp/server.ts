import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { type AssemblyIndexNode } from '@aws-cdk/cloud-assembly-api';
import type { Toolkit } from '@aws-cdk/toolkit-lib';
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
import { createIgnoreMatcher } from '../api-private';
import { codeLensesForFile } from './codelens';
import { executeCommand, SUPPORTED_COMMANDS, type NotifySink } from './commands';
import { GetConstructTreeRequest, type ConstructSourceEntry, type GetConstructTreeResult } from './construct-tree-request';
import { mapViolationsToDiagnostics } from './diagnostics';
import { cdkLspManifest } from './features';
import { hoverForPosition } from './hover';
import { type LogSink, NOOP_LOGGER } from './log-sink';
import { offsetAtPosition } from './positions';
import { synthFailureDiagnostics } from './synth-diagnostics';
import { sourceTargetAtTemplateOffset } from './template-locator';
import { AssemblyIndexWithSourceLocations, assertRelativePath, type RelativePath } from '../core/assembly-index-with-source-locations';
import {
  webAssemblyDataFromAssembly,
  type AssemblyReadResult,
} from '../core/assembly-reader';
import {
  startAssemblyWatcher as defaultStartAssemblyWatcher,
  type AssemblyWatcher,
  type AssemblyWatcherOptions,
} from '../core/assembly-watcher';
import { readCdkConfig } from '../core/cdk-config';
import { readAssemblyDirectory } from '../core/read-cdk-assembly';
import { SOURCE_WATCH_EXCLUDES } from '../core/source-watcher';
import { runSynth, type SynthRunResult } from '../core/synth-runner';
import type { TemplateRanges } from '../core/template-ranges';
import { indexTemplateRanges } from '../core/template-ranges';
import { umap } from '../core/undef';

/**
 * Synth concurrency latch, mirroring `cdk watch` (see toolkit.ts). 'open' = idle,
 * 'synthing' = a synth is running, 'queued' = a save arrived mid-synth and a
 * follow-up is owed. No 'pre-ready' (unlike watch there is no ready gate; the LSP
 * synths on demand).
 */
type SynthLatch = 'open' | 'synthing' | 'queued';

export interface LspHandlerOptions {
  readonly toolkit: Toolkit;
  /** Shipped CDK CLI version to advertise (serverInfo + manifest). Injected by the entrypoint; omitted in tests. */
  readonly version?: string;
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
  /** User-facing notification sink. Injected by startServer; omitted in tests. */
  readonly notify?: NotifySink;
}

export interface LspServerOptions {
  readonly readable: NodeJS.ReadableStream;
  readonly writable: NodeJS.WritableStream;
  readonly toolkitFactory: (console: RemoteConsole) => Toolkit;
  /** Shipped CDK CLI version to advertise. Injected by main.ts from the CLI. */
  readonly version?: string;
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
  /** Serve the source-resolved construct tree (flattened) for a client overlay. */
  onGetConstructTree(): Promise<GetConstructTreeResult>;
  onShutdown(): void;
}

/**
 * Build the LSP message handlers as plain functions over closed-over state.
 * No streams, no JSON-RPC, no framework — testable in isolation.
 */
export function createLspHandlers(options: LspHandlerOptions): LspHandlers {
  const log = options.logger ?? NOOP_LOGGER;
  const onPublishDiagnostics = options.onPublishDiagnostics ?? (() => {
  });
  const onRefreshCodeLenses = options.onRefreshCodeLenses ?? (() => {
  });
  const startWatcher = options.startAssemblyWatcher ?? defaultStartAssemblyWatcher;
  const notify = options.notify ?? {
    info: () => {
    },
    error: () => {
    },
    withProgress: <T>(_msg: string, fn: () => Promise<T>) => fn(),
  };

  let applicationDir: string | undefined;
  // URIs (source files, or cdk.json) currently showing synth-failure diagnostics.
  let synthFailureUris = new Set<string>();
  let autoSynthEnabled = false; // off by default; user enables via the CodeLens toggle
  let shouldIgnore: (filePath: string) => boolean = () => false;
  let assemblyWatcher: AssemblyWatcher | undefined;
  // Latest index from readAssembly, served to CodeLens. Refreshed at startup
  // and whenever the cdk.out watcher detects a re-synth.
  let cachedIndex = AssemblyIndexWithSourceLocations.empty();
  let cachedWarnings: readonly string[] = [];
  let cachedAssemblyDir: string | undefined;
  // URIs that currently have published diagnostics. On each refresh we publish
  // an empty array for any URI that no longer has diagnostics, otherwise a
  // resolved violation would leave a stale squiggle behind.
  let publishedUris = new Set<string>();
  // Whether the client supports a server-initiated CodeLens refresh. Captured
  // at initialize; if false we skip the refresh request and lenses update on
  // the editor's next natural re-query.
  let codeLensRefreshSupported = false;

  const shutdown = new AbortController();

  // Single source of truth for the project root: the directory the client opened
  // (applicationDir from initialize), falling back to cwd for non-IDE callers.
  // Every consumer (assembly read, watcher, synth, diagnostics) reads this so
  // they never disagree about which project is being operated on.
  function currentProjectDir(): string {
    return applicationDir ?? process.cwd();
  }

  async function refreshFromAssembly(projectDir: string, assemblyDir: string): Promise<void> {
    let result: AssemblyReadResult;
    try {
      await using asm = await readAssemblyDirectory(options.toolkit, shutdown.signal, assemblyDir);
      result = {
        status: 'success',
        data: await webAssemblyDataFromAssembly(projectDir, asm),
        mtimeMs: asm.cloudAssembly.mtimeMs,
      };
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        result = {
          status: 'not-found',
        };
      } else {
        result = {
          status: 'error',
          message: e.message ?? String(e),
        };
      }
    }

    if (result.status === 'error') {
      log.error(`Failed to read cloud assembly: ${result.message}`);
      return;
    }
    if (result.status === 'not-found') return;

    const { index, violations, warnings } = result.data;
    for (const warning of warnings) {
      log.warn(warning);
    }

    cachedIndex = index;
    cachedWarnings = warnings;
    cachedAssemblyDir = assemblyDir;

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

  // Concurrency latch, mirroring `cdk watch` (toolkit.ts): a synth requested
  // while one runs is batched into a single follow-up, so synths run one at a
  // time and the assembly catches up to the latest save.
  let synthLatch: SynthLatch = 'open';
  const synthListeners: Array<() => void> = [];

  /**
   * Queue a new synth
   *
   * Start it immediately if we are not currently synthing; otherwise, another instance
   * of this async function is already running. Mark the latch as
   * queued and the existing instance will check it in a loop.
   *
   * Returns a Promise that resolves once the queued synth has completed.
   */
  function queueSynth() {
    const ret = new Promise<void>((resolve) => {
      synthListeners.push(resolve);
    });

    if (synthLatch === 'open') {
      void runSynthLoop();
    } else {
      synthLatch = 'queued';
    }

    return ret;

    async function runSynthLoop() {
      try {
        do {
          synthLatch = 'synthing' as SynthLatch;
          const currentListeners = synthListeners.splice(0, synthListeners.length);
          const result = await runSynth({
            toolkit: options.toolkit,
            projectDir: currentProjectDir(),
            abort: shutdown.signal,
          });
          publishSynthDiagnostics(result);
          for (const listener of currentListeners) {
            listener();
          }

          // If another synth was queued while we were running, the loop will go around again.
        } while (synthLatch === 'queued' && !shutdown.signal.aborted);
      } catch (e: any) {
        log.error(`Synth failed during queued run: ${e.message ?? String(e)}`);
      } finally {
        synthLatch = 'open';
      }
    }
  }

  // Publish diagnostics for a failed synth (one per failing source file, or
  // cdk.json as a fallback) and clear them once a synth succeeds. The cdk.out
  // watcher owns violation diagnostics; this only manages synth-failure ones.
  function publishSynthDiagnostics(result: SynthRunResult): void {
    switch (result.status) {
      case 'success':
        // Silent. The watcher refreshes the editor when `cdk.out` changes.
        break;
      case 'unavailable':
        notify.info('No CDK app found in the current project directory');
        break;
      case 'app-failure':
      case 'error':
        notify.error(`CDK synth failed: ${result.message}`);
        break;
    }

    // A successful synth resolves all failures; 'unavailable' means there is no
    // app to fail, so any prior synth-failure diagnostics no longer apply.
    if (result.status === 'success' || result.status === 'unavailable') {
      clearSynthFailures();
      return;
    }
    const failures = synthFailureDiagnostics(result, currentProjectDir());
    if (failures.length === 0) return;

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
      const manifest = cdkLspManifest(options.version);
      return {
        serverInfo: { name: 'cdk-lsp', version: manifest.version },
        capabilities: {
          textDocumentSync: {
            // Accept didOpen/didClose: IntelliJ only attaches diagnostics, hover,
            // and definition to documents opened against the server.
            openClose: true,
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
          // Non-standard: lets a client discover CDK-specific features and the
          // wire protocol version ahead of use; also backs `cdk lsp --features`.
          experimental: { cdk: manifest },
        },
      };
    },
    async onInitialized() {
      const projectDir = currentProjectDir();
      const assemblyDir = path.resolve(projectDir, (await readCdkConfig(projectDir))?.output ?? 'cdk.out');

      // Ignore non-source paths (deps, cdk.out, dotfiles) using the same policy
      // the web explorer's source watcher applies.
      shouldIgnore = createIgnoreMatcher({
        exclude: SOURCE_WATCH_EXCLUDES,
        rootDir: projectDir,
      });
      await refreshFromAssembly(projectDir, assemblyDir);

      // Watch cdk.out so any synth (an external `cdk synth`/`cdk watch`, or a
      // future in-process synth) refreshes the editor's diagnostics and lenses.
      assemblyWatcher = startWatcher({
        assemblyDir,
        onChange: () => {
          // refreshFromAssembly is async; surface a rejection rather than
          // floating the promise from this watcher callback.
          refreshFromAssembly(projectDir, assemblyDir).catch((err) =>
            log.error(`Assembly refresh failed: ${(err as Error).message}`));
        },
        onError: (err) => log.error(`Assembly watcher error: ${(err as Error).message}`),
      });
    },
    onDidSaveTextDocument(params) {
      if (shutdown.signal.aborted) return;
      const filePath = fileURLToPath(params.textDocument.uri);
      if (shouldIgnore(filePath)) return;
      if (!autoSynthEnabled) return;
      void queueSynth();
    },
    onCodeLens(params) {
      const assemblyDir = cachedAssemblyDir ?? path.join(currentProjectDir(), 'cdk.out');
      return codeLensesForFile(cachedIndex, assemblyDir, fileURLToPath(params.textDocument.uri), autoSynthEnabled);
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
      if (!await cachedIndex.assemblyDir.contains(filePath)) {
        return undefined;
      }
      let templateText: string;
      try {
        templateText = await fs.readFile(filePath, 'utf-8');
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
        synth: queueSynth,
        toggleAutoSynth: (enabled) => {
          autoSynthEnabled = enabled;
          onRefreshCodeLenses();
        },
        notify,
      });
    },
    async onHover(params) {
      try {
        return await hoverForPosition(log, cachedIndex, fileURLToPath(params.textDocument.uri), params.position,
          (file) => fs.readFile(cachedIndex.assemblyDir.absolute(file), 'utf-8'));
      } catch (e) {
        log.error(`Failed to get hover information: ${e}`);
        throw e;
      }
    },
    async onGetConstructTree() {
      const assemblyDir = cachedAssemblyDir ?? path.join(currentProjectDir(), 'cdk.out');
      if (cachedAssemblyDir === undefined) {
        return { status: 'no-assembly', assemblyDir, entries: [], warnings: [] };
      }
      // Flatten the already-decorated tree in pre-order; the client joins on `path`.
      // Parse each template's resource ranges at most once per request.
      const rangesByTemplate = new Map<string, TemplateRanges | undefined>();
      const templateRangesFor = async (templateFile: RelativePath): Promise<TemplateRanges | undefined> => {
        if (!rangesByTemplate.has(templateFile)) {
          try {
            const absPath = cachedIndex.assemblyDir.absolute(templateFile);
            rangesByTemplate.set(templateFile, indexTemplateRanges(await fs.readFile(absPath, 'utf-8')));
          } catch {
            rangesByTemplate.set(templateFile, undefined);
          }
        }
        return rangesByTemplate.get(templateFile);
      };
      const entries: ConstructSourceEntry[] = [];
      const collect = async (nodes: readonly AssemblyIndexNode[]): Promise<void> => {
        for (const node of nodes) {
          const templateOffset =
            node.cfnResource.assemblyRelativeTemplateFile && node.cfnResource.logicalId
              ? (await templateRangesFor(assertRelativePath(node.cfnResource.assemblyRelativeTemplateFile)))?.block(node.cfnResource.logicalId)?.start
              : undefined;

          entries.push({
            path: node.constructPath,
            id: node.id,
            type: node.cfnResource.type,
            logicalId: node.cfnResource.logicalId,
            sourceLocation: umap(cachedIndex.sourceLocationFor(node), (sl) => ({
              ...sl,
              file: cachedIndex.appDir.absolute(sl.file),
            })),
            templateFile: umap(node.cfnResource.assemblyRelativeTemplateFile, (x) =>
              cachedIndex.assemblyDir.absolute(assertRelativePath(x))),
            templateOffset,
          });
          await collect(Object.values(node.children));
        }
      };
      await collect(cachedIndex.assemblyIndex.firstLevelChildren);
      return { status: 'ok', assemblyDir, entries, warnings: [...cachedWarnings] };
    },
    onShutdown() {
      shutdown.abort();
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
    version: options.version,
    toolkit: options.toolkitFactory(connection.console),
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
  connection.onRequest(GetConstructTreeRequest, () => handlers.onGetConstructTree());
  connection.onShutdown(() => handlers.onShutdown());
  connection.onExit(() => process.exit(0));

  connection.listen();
}
