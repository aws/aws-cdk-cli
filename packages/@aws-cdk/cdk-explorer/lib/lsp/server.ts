import { fileURLToPath } from 'url';
import {
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  type DidSaveTextDocumentParams,
  type InitializeParams,
  type InitializeResult,
} from 'vscode-languageserver/node';
/* eslint-disable import/no-relative-packages */
import { WATCH_EXCLUDE_DEFAULTS } from '../../../toolkit-lib/lib/actions/watch/private/helpers';
import { createIgnoreMatcher } from '../../../toolkit-lib/lib/util/glob-matcher';

export interface LspHandlerOptions {
  /**
   * Injectable synth trigger for testability.
   * Called when `didSave` fires on a tracked source file.
   */
  readonly onSynthRequest?: (projectDir: string) => void;
  /**
   * Sink for non-fatal error messages. In production, the connection's
   * console writes to the editor's Output panel; in tests, capture into an array.
   */
  readonly logger?: { error(message: string): void };
}

/** Pure handler functions for LSP messages, extracted for direct unit testing. */
export interface LspHandlers {
  onInitialize(params: InitializeParams): InitializeResult;
  onInitialized(): void;
  onDidSaveTextDocument(params: DidSaveTextDocumentParams): void;
  onShutdown(): void;
}

export interface LspServerOptions extends LspHandlerOptions {
  readonly readable: NodeJS.ReadableStream;
  readonly writable: NodeJS.WritableStream;
}

/**
 * Build the LSP message handlers as plain functions over closed-over state.
 */
export function createLspHandlers(options: LspHandlerOptions = {}): LspHandlers {
  const onSynthRequest = options.onSynthRequest ?? (() => {
  });
  const logger = options.logger ?? {
    error: () => {
    },
  };

  let applicationDir: string | undefined;
  let shutdownRequested = false;
  let shouldIgnore: (filePath: string) => boolean = () => false;

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
    },
    onDidSaveTextDocument(params) {
      if (shutdownRequested) return;
      const filePath = fileURLToPath(params.textDocument.uri);
      if (shouldIgnore(filePath)) return;
      const projectDir = applicationDir ?? process.cwd();
      try {
        onSynthRequest(projectDir);
      } catch (err) {
        logger.error(`Synth request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
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
    logger: connection.console,
  });

  connection.onInitialize((params) => handlers.onInitialize(params));
  connection.onInitialized(() => handlers.onInitialized());
  connection.onDidSaveTextDocument((params) => handlers.onDidSaveTextDocument(params));
  connection.onShutdown(() => handlers.onShutdown());
  connection.onExit(() => process.exit(0));

  connection.listen();
}
