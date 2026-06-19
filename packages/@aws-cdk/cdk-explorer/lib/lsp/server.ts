import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
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
  type DefinitionParams,
  type DidSaveTextDocumentParams,
  type Diagnostic,
  type InitializeParams,
  type InitializeResult,
  type Location,
} from 'vscode-languageserver/node';
/* eslint-disable import/no-relative-packages */
import { codeLensesForFile } from './codelens';
import { mapViolationsToDiagnostics } from './diagnostics';
import { offsetAtPosition } from './positions';
import { sourceTargetAtTemplateOffset } from './template-locator';
import { WATCH_EXCLUDE_DEFAULTS } from '../../../toolkit-lib/lib/actions/watch/private/helpers';
import { createIgnoreMatcher } from '../../../toolkit-lib/lib/util/glob-matcher';
import {
  readAssembly as defaultReadAssembly,
  type AssemblyReadResult,
  type ConstructNode,
} from '../core/assembly-reader';

export interface LspHandlerOptions {
  /** Callback invoked on `didSave` for tracked source files. */
  readonly onSynthRequest?: (projectDir: string) => void;
  /** Override readAssembly for tests. Defaults to reading <applicationDir>/cdk.out. */
  readonly readAssembly?: (assemblyDir: string) => Promise<AssemblyReadResult>;
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
  onInitialized(): Promise<void>;
  onDidSaveTextDocument(params: DidSaveTextDocumentParams): void;
  onCodeLens(params: CodeLensParams): CodeLens[];
  onDefinition(params: DefinitionParams): Location | undefined;
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
  // Latest index from readAssembly, served to CodeLens without re-reading
  // cdk.out. Refreshed on every onInitialized; cdk.out watcher is a future feature.
  let cachedIndex: ConstructIndex<ConstructNode> = ConstructIndex.fromTree<ConstructNode>([]);

  async function refreshFromAssembly(projectDir: string): Promise<void> {
    const assemblyDir = path.join(projectDir, 'cdk.out');
    const result = await readAssembly(assemblyDir);

    if (result.status === 'error') {
      log.error(`Failed to read cloud assembly: ${result.message}`);
      return;
    }
    if (result.status === 'not-found') return;

    const { tree, violations, violationsError, warnings } = result.data;
    for (const warning of warnings) {
      log.warn(warning);
    }
    if (violationsError) {
      log.warn(`validation-report.json failed to load: ${violationsError}`);
    }

    cachedIndex = ConstructIndex.fromTree(tree);

    const { byUri, dropped } = mapViolationsToDiagnostics(violations, cachedIndex);

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
          // Go-to-definition from a synthesized template back to construct source.
          definitionProvider: true,
        },
      };
    },
    async onInitialized() {
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
      await refreshFromAssembly(projectDir);
    },
    onDidSaveTextDocument(params) {
      if (shutdownRequested) return;
      const filePath = fileURLToPath(params.textDocument.uri);
      if (shouldIgnore(filePath)) return;
      const projectDir = applicationDir ?? process.cwd();
      try {
        onSynthRequest(projectDir);
      } catch (err) {
        log.error(`Synth request failed: ${(err as Error).message}`);
      }
    },
    onCodeLens(params) {
      return codeLensesForFile(cachedIndex, params.textDocument.uri);
    },
    onDefinition(params) {
      // Only synthesized templates link back to source, and only file: URIs are
      // readable. Check the scheme before fileURLToPath, which throws on other
      // schemes (untitled:, git:, diff views).
      const uri = params.textDocument.uri;
      if (!uri.startsWith('file:') || !uri.endsWith('.template.json')) {
        return undefined;
      }
      const filePath = fileURLToPath(uri);
      let templateText: string;
      try {
        templateText = fs.readFileSync(filePath, 'utf-8');
      } catch {
        return undefined;
      }
      // Offsets come from current disk text; the owner is looked up in the index
      // built at startup. If the template was re-synthesized since, a missing
      // match degrades to undefined rather than navigating to the wrong place.
      const offset = offsetAtPosition(templateText, params.position);
      return sourceTargetAtTemplateOffset(cachedIndex, filePath, templateText, offset);
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
  connection.onShutdown(() => handlers.onShutdown());
  connection.onExit(() => process.exit(0));

  connection.listen();
}
