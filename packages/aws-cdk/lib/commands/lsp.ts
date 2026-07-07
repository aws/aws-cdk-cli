import * as process from 'process';
import { startLspServer } from '@aws-cdk/cdk-explorer';

/**
 * Starts the CDK Language Server over stdio.
 *
 * The server speaks LSP/JSON-RPC on stdin/stdout, so this command must not
 * write anything else to stdout. CDK CLI logs go to stderr by default, which
 * keeps the protocol channel clean. The process runs until the LSP client
 * closes the stdio channel (stdin end), then exits 0.
 */
export async function lsp(): Promise<number> {
  startLspServer();

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    process.stdin.once('end', done);
    process.stdin.once('close', done);
  });

  return 0;
}
