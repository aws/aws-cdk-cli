import { startServer } from './server';

try {
  startServer({
    readable: process.stdin,
    writable: process.stdout,
  });
} catch (err) {
  const e = err as Error;
  process.stderr.write(`CDK LSP startup fatal: ${e.stack ?? e.message}\n`);
  process.exit(1);
}
