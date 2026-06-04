import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  type CodeLens,
  type CodeLensParams,
  type DidSaveTextDocumentParams,
  type Diagnostic,
  type InitializeParams,
  type InitializeResult,
} from 'vscode-languageserver/node';
/* eslint-disable import/no-relative-packages */
import { codeLensesForFile } from './codelens';
import { mapViolationsToDiagnostics } from './diagnostics';
import { WATCH_EXCLUDE_DEFAULTS } from '../../../toolkit-lib/lib/actions/watch/private/helpers';
import { createIgnoreMatcher } from '../../../toolkit-lib/lib/util/glob-matcher';
import {
  readAssembly as defaultReadAssembly,
  type AssemblyReadResult,
  type ConstructNode,
} from '../core/assembly-reader';
import { indexNodesByPath } from '../core/tree-utils';

export interface LspHandlerOptions {
  /** Callback invoked on `didSave` for tracked source files. */
  readonly onSynthRequest?: (projectDir: string) => void;
  /** Override readAssembly for tests. Defaults to reading <applicationDir>/cdk.out. */
  readonly readAssembly?: (assemblyDir: string, onWarn?: (msg: string) => void) => AssemblyReadResult;
  /**
   * Sink for non-fatal messages. In production, the connection's console writes
   * to the editor's Output panel; in tests, capture into an array.
   */
  readonly logger?: LogSink;
  /** Receives diagnostics ready to be published to the editor. */
  readonly onPublishDiagnostics?: (uri: string, diagnostics: Diagnostic[]) => void;
}

export interface LspServerOptions extends LspHandlerOptions {
  readonly readable: NodeJS.ReadableStream;
  readonly writable: NodeJS.WritableStream;
}

/** Pure handler functions for LSP messages, extracted for direct unit testing. */
export interface LspHandlers {
  onInitialize(params: InitializeParams): InitializeResult;
  onInitialized(): void;
  onDidSaveTextDocument(params: DidSaveTextDocumentParams): void;
  onCodeLens(params: CodeLensParams): CodeLens[];
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

/**
 * Build the LSP message handlers as plain functions over closed-over state.
 * No streams, no JSON-RPC, no framework — testable in isolation.
 */
export function createLspHandlers(options: LspHandlerOptions = {}): LspHandlers {
  const onSynthRequest = options.onSynthRequest ?? (() => {
  });
  const readAssembly = options.readAssembly ?? defaultReadAssembly;
  const log = options.logger ?? NOOP_LOGGER;
  const onPublishDiagnostics = options.onPublishDiagnostics ?? (() => {
  });

  let applicationDir: string | undefined;
  let shutdownRequested = false;
  let shouldIgnore: (filePath: string) => boolean = () => false;
  // Latest tree from readAssembly, served to CodeLens without re-reading
  // cdk.out. Refreshed on every onInitialized; cdk.out watcher is a future feature.
  let cachedTree: readonly ConstructNode[] = [];

  function refreshFromAssembly(projectDir: string): void {
    const assemblyDir = path.join(projectDir, 'cdk.out');
    const result = readAssembly(assemblyDir, (msg) => log.warn(msg));

    if (result.status === 'error') {
      log.error(`Failed to read cloud assembly: ${result.message}`);
      return;
    }
    if (result.status === 'not-found') return;

    const { tree, violations, violationsError } = result.data;
    if (violationsError) {
      log.warn(`validation-report.json failed to load: ${violationsError}`);
    }

    cachedTree = tree;

    const nodesByPath = indexNodesByPath(tree);
    const { byUri, dropped } = mapViolationsToDiagnostics(violations, nodesByPath);

    for (const drop of dropped) {
      log.warn(`Dropped diagnostic for '${drop.ruleName}' at '${drop.constructPath}': ${drop.reason}`);
    }
    for (const [uri, diagnostics] of byUri) {
      onPublishDiagnostics(uri, diagnostics);
    }
  }

  return {
    onInitialize(params) {
      applicationDir = params.initializationOptions?.applicationDir;
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
        },
      };
    },
    onInitialized() {
      const projectDir = applicationDir ?? process.cwd();
      // Same exclusion logic as toolkit-lib's watch():
      // WATCH_EXCLUDE_DEFAULTS covers common non-source dirs, then we add cdk.out
      // (our own output) and dotfiles (editor configs, .git, etc.)
      shouldIgnore = createIgnoreMatcher({
        exclude: [
          ...WATCH_EXCLUDE_DEFAULTS,
          '**/node_modules/**',
          '**/cdk.out/**',
          '.*',
          '**/.*',
          '**/.*/**',
        ],
        rootDir: projectDir,
      });
      refreshFromAssembly(projectDir);
    },
    onDidSaveTextDocument(params) {
      if (shutdownRequested) return;
      const filePath = fileURLToPath(params.textDocument.uri);
      if (shouldIgnore(filePath)) return;
      const projectDir = applicationDir ?? process.cwd();
      try {
        onSynthRequest(projectDir);
      } catch (err) {
        log.error(`Synth request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    onCodeLens(params) {
      return codeLensesForFile(cachedTree, params.textDocument.uri);
    },
    onShutdown() {
      shutdownRequested = true;
    },
  };
}

export function startServer(options: LspServerOptions): void {
  const connection = createConnection(
    ProposedFeatures.all,
    new StreamMessageReader(options.readable),
    new StreamMessageWriter(options.writable),
  );

  const handlers = createLspHandlers({
    onSynthRequest: options.onSynthRequest,
    readAssembly: options.readAssembly,
    logger: connection.console,
    onPublishDiagnostics: (uri, diagnostics) => {
      void connection.sendDiagnostics({ uri, diagnostics });
    },
  });

  connection.onInitialize((params) => handlers.onInitialize(params));
  connection.onInitialized(() => handlers.onInitialized());
  connection.onDidSaveTextDocument((params) => handlers.onDidSaveTextDocument(params));
  connection.onCodeLens((params) => handlers.onCodeLens(params));
  connection.onShutdown(() => handlers.onShutdown());
  connection.onExit(() => process.exit(0));

  connection.listen();
}
