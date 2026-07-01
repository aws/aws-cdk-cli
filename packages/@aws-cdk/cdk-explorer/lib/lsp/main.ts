import { Toolkit } from '@aws-cdk/toolkit-lib';
import { LspIoHost } from './io-host';
import { startServer } from './server';
import { runSynth } from '../core/synth-runner';

try {
  startServer({
    readable: process.stdin,
    writable: process.stdout,
    // Build the Toolkit once connection.console exists (so output reaches the
    // editor Output panel), then bind the two ops the handlers need. The read
    // lock comes from fromAssemblyDirectory().produce(), so we never touch RWLock.
    toolkitBindingsFactory: (console) => {
      const toolkit = new Toolkit({ ioHost: new LspIoHost(console) });
      return {
        synthRunner: (projectDir) => runSynth({ toolkit, projectDir }),
        acquireAssemblyLock: async (assemblyDir) => {
          const cx = await toolkit.fromAssemblyDirectory(assemblyDir, { failOnMissingContext: false });
          const readable = await cx.produce();
          return { release: () => readable.dispose() };
        },
      };
    },
  });
} catch (err) {
  const e = err as Error;
  process.stderr.write(`CDK LSP startup fatal: ${e.stack ?? e.message}\n`);
  process.exit(1);
}
