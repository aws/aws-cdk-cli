import { Toolkit } from '@aws-cdk/toolkit-lib';
import { LspIoHost } from './io-host';
import { startServer } from './server';
import { runSynth } from '../core/synth-runner';

try {
  startServer({
    readable: process.stdin,
    writable: process.stdout,
    // synthRunnerFactory: startServer invokes it once, after the LSP connection
    // exists, so the runner it returns can route Toolkit output to the editor's
    // Output panel via connection.console. The handler passes the resolved
    // project root on each call; the runner reads that project's cdk.json `app`
    // per synth, so it is always built and "no app" is reported per call.
    synthRunnerFactory: (console) => {
      const toolkit = new Toolkit({ ioHost: new LspIoHost(console) });
      return (projectDir) => runSynth({ toolkit, projectDir });
    },
  });
} catch (err) {
  const e = err as Error;
  process.stderr.write(`CDK LSP startup fatal: ${e.stack ?? e.message}\n`);
  process.exit(1);
}
