// DEVELOPMENT-ONLY extension. See ../README.md.
//
// Spawns the local @aws-cdk/cdk-explorer LSP server (compiled to lib/lsp/main.js)
// as a child process and connects it as a standard LSP client.

import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, TransportKind, type LanguageClientOptions } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

const LSP_SERVER_RELATIVE = path.join(
  '..',
  'packages',
  '@aws-cdk',
  'cdk-explorer',
  'lib',
  'lsp',
  'main.js',
);

export function activate(context: vscode.ExtensionContext): void {
  const serverModule = context.asAbsolutePath(LSP_SERVER_RELATIVE);
  const outputChannel = vscode.window.createOutputChannel('CDK LSP');
  context.subscriptions.push(outputChannel);

  const clientOptions: LanguageClientOptions = {
    // The LSP currently produces source-linked data only for TypeScript apps.
    documentSelector: [{ scheme: 'file', language: 'typescript' }],
    initializationOptions: {
      applicationDir: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    },
    outputChannel,
  };

  // The LSP server (lib/lsp/main.ts) hard-wires stdin/stdout for the connection
  // streams, matching how `cdk lsp` will be invoked in production. Stdio here
  // matches that contract exactly.
  client = new LanguageClient(
    'cdkLsp',
    'CDK LSP (development only)',
    {
      run: { module: serverModule, transport: TransportKind.stdio },
      debug: { module: serverModule, transport: TransportKind.stdio },
    },
    clientOptions,
  );

  context.subscriptions.push({ dispose: () => client?.stop() });

  client.start().catch((err) => {
    outputChannel.appendLine(`CDK LSP failed to start: ${err?.stack ?? err}`);
    outputChannel.show(true);
  });
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
