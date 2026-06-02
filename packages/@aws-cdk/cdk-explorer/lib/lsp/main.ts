import { startServer } from './server';

try {
  startServer({
    readable: process.stdin,
    writable: process.stdout,
  });
} catch (err) {
  process.stderr.write(`CDK LSP startup fatal: ${err}\n`);
  process.exit(1);
}
