import { fileURLToPath } from 'url';
import {
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
} from 'vscode-languageserver/node';
import { createIgnoreMatcher, WATCH_EXCLUDE_DEFAULTS } from '../toolkit-internals';

export interface LspServerOptions {
  readonly readable: NodeJS.ReadableStream;
  readonly writable: NodeJS.WritableStream;
  /**
   * Injectable synth trigger for testability.
   * Called when `didSave` fires on a tracked source file.
   * Defaults to a no-op, real synth wiring added later.
   */
  readonly onSynthRequest?: (projectDir: string) => void;
}

export function startServer(options: LspServerOptions): void {
  const connection = createConnection(
    ProposedFeatures.all,
    new StreamMessageReader(options.readable),
    new StreamMessageWriter(options.writable),
  );

  const onSynthRequest = options.onSynthRequest ?? (() => {
  });

  let applicationDir: string | undefined;
  let shutdownRequested = false;
  let shouldIgnore: (filePath: string) => boolean = () => false;

  connection.onInitialize((params: InitializeParams): InitializeResult => {
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
  });

  connection.onInitialized(() => {
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
  });

  connection.onDidSaveTextDocument((params) => {
    if (shutdownRequested) return;
    const filePath = fileURLToPath(params.textDocument.uri);
    if (!shouldIgnore(filePath)) {
      const projectDir = applicationDir ?? process.cwd();
      try {
        onSynthRequest(projectDir);
      } catch (err) {
        // Surfaces in the Output panel
        connection.console.error(`Synth request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  connection.onShutdown(() => {
    shutdownRequested = true;
  });

  connection.onExit(() => {
    process.exit(0);
  });

  connection.listen();
}
