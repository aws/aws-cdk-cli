import * as process from 'process';
import { cdkLspManifest, startLspServer } from '@aws-cdk/cdk-explorer';

/**
 * Runs the CDK Language Server command.
 *
 * With `--features`, prints the LSP capability manifest as JSON and exits.
 * Otherwise starts the server, which speaks LSP/JSON-RPC on stdin/stdout -- in
 * that mode the command must not write anything else to stdout (CDK CLI logs go
 * to stderr, keeping the protocol channel clean). The server runs until the LSP
 * client closes the stdio channel (stdin end), then exits 0.
 */
export async function lsp(options: { readonly features?: boolean } = {}): Promise<number> {
  // `--features` is a probe: print the capability manifest as JSON and exit
  // without starting the server, so a client can detect LSP presence and
  // features without opening a session.
  if (options.features) {
    process.stdout.write(JSON.stringify(cdkLspManifest()) + '\n');
    return 0;
  }

  startLspServer();

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    process.stdin.once('end', done);
    process.stdin.once('close', done);
  });

  return 0;
}
