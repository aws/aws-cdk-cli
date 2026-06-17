import { Toolkit } from '@aws-cdk/toolkit-lib';
import { LspIoHost } from './io-host';
import { startServer } from './server';
import { readCdkConfig } from '../core/cdk-config';
import { runSynth } from '../core/synth-runner';

try {
  const projectDir = process.cwd();
  const config = readCdkConfig(projectDir);

  startServer({
    readable: process.stdin,
    writable: process.stdout,
    // synthRunnerFactory: startServer invokes it once, after the LSP connection
    // exists, so the runner it returns can route Toolkit output to the editor's
    // Output panel via connection.console. Built only when cdk.json has an `app`.
    synthRunnerFactory: config.app !== undefined ? (console) => {
      const toolkit = new Toolkit({ ioHost: new LspIoHost(console) });
      return () => runSynth({ toolkit, projectDir, app: config.app! });
    } : undefined,
  });
} catch (err) {
  const e = err as Error;
  process.stderr.write(`CDK LSP startup fatal: ${e.stack ?? e.message}\n`);
  process.exit(1);
}
