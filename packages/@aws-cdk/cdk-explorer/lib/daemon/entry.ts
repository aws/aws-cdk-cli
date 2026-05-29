import { DaemonServer } from './server';
import { socketPathForProject, logPathForProject } from './socket-path';

function main() {
  const projectDir = parseProjectDir();
  const socketPath = socketPathForProject(projectDir);
  const logFile = logPathForProject(projectDir);

  const server = new DaemonServer({
    socketPath,
    projectDir,
    logFile,
    onSynth: stubSynth,
  });

  const shutdown = () => void server.stop();
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.start().then(
    () => {
      // eslint-disable-next-line no-console
      console.log(`Daemon started: pid=${process.pid} socket=${socketPath}`);
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error('Daemon failed to start:', err);
      process.exit(1);
    },
  );
}

function parseProjectDir(): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--project-dir');
  if (idx === -1 || idx + 1 >= args.length) {
    // eslint-disable-next-line no-console
    console.error('Usage: entry.js --project-dir <path>');
    process.exit(1);
  }
  return args[idx + 1];
}

async function stubSynth(): Promise<void> {
}

main();
