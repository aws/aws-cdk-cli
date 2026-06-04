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

export interface LspServerOptions {
  readonly readable: NodeJS.ReadableStream;
  readonly writable: NodeJS.WritableStream;
  /**
   * Callback invoked on `didSave` for tracked source files
   */
  readonly onSynthRequest?: (projectDir: string) => void;
}

interface LspHandlers {
  onInitialize(params: InitializeParams): InitializeResult;
  onInitialized(): void;
  onDidSaveTextDocument(params: DidSaveTextDocumentParams): void;
  onShutdown(): void;
}

interface LogSink {
  error(message: string): void;
}

function buildHandlers(onSynthRequest: (projectDir: string) => void, log: LogSink): LspHandlers {
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
        log.error(`Synth request failed: ${err instanceof Error ? err.message : String(err)}`);
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

  const onSynthRequest = options.onSynthRequest ?? (() => {
  });
  const handlers = buildHandlers(onSynthRequest, connection.console);

  connection.onInitialize((params) => handlers.onInitialize(params));
  connection.onInitialized(() => handlers.onInitialized());
  connection.onDidSaveTextDocument((params) => handlers.onDidSaveTextDocument(params));
  connection.onShutdown(() => handlers.onShutdown());
  connection.onExit(() => process.exit(0));

  connection.listen();
}
