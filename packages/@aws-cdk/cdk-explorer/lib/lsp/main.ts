import { Toolkit } from '@aws-cdk/toolkit-lib';
import { LspIoHost } from './io-host';
import { startServer } from './server';

/**
 * Starts the CDK Language Server over the process's stdin/stdout. Wires the
 * Toolkit-backed bindings the handlers need. This is the single entrypoint
 * used by the `cdk lsp` CLI command.
 */
export function startLspServer(version?: string): void {
  startServer({
    readable: process.stdin,
    writable: process.stdout,
    version,
    toolkitFactory: (console) => new Toolkit({ ioHost: new LspIoHost(console) }),
  });
}
