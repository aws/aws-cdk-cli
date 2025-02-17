import { spawnSync } from 'child_process';
import * as path from 'path';

export function log(message: string) {
  console.log(message);
}

export function sourcePath(folder: string) {
  return path.join(__dirname, '..', 'lib', folder, 'schema.ts');
}

export function generatedPath(schemaName: string) {
  return path.join('schema', `${schemaName}.schema.json`);
}

export function exec(
  commandLine: string[],
  options: { cwd?: string; verbose?: boolean; env?: any } = {}
): string {
  const proc = spawnSync(commandLine[0], commandLine.slice(1), {
    stdio: ['ignore', 'pipe', options.verbose ? 'inherit' : 'pipe'], // inherit STDERR in verbose mode
    env: {
      ...process.env,
      ...options.env,
    },
    cwd: options.cwd,
  });

  if (proc.error) {
    throw proc.error;
  }
  if (proc.status !== 0) {
    if (process.stderr) {
      // will be 'null' in verbose mode
      process.stderr.write(proc.stderr);
    }
    throw new Error(
      `Command exited with ${proc.status ? `status ${proc.status}` : `signal ${proc.signal}`}`
    );
  }

  const output = proc.stdout.toString('utf-8').trim();

  return output;
}
