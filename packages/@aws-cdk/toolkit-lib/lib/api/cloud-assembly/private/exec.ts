import * as child_process from 'node:child_process';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import split = require('split2');
import { AssemblyError } from '../../../toolkit/toolkit-error';

type EventPublisher = (event: 'open' | 'data_stdout' | 'data_stderr' | 'close', line: string) => void;

interface ExecOptions {
  eventPublisher?: EventPublisher;
  env?: { [key: string]: string | undefined };
  cwd?: string;
}

/**
 * Execute a command and args in a child process
 */
export async function execInChildProcess(commandAndArgs: string, options: ExecOptions = {}) {
  return new Promise<void>((ok, fail) => {
    // We use a slightly lower-level interface to:
    //
    // - Pass arguments in an array instead of a string, to get around a
    //   number of quoting issues introduced by the intermediate shell layer
    //   (which would be different between Linux and Windows).
    //
    // - We have to capture any output to stdout and stderr sp we can pass it on to the IoHost
    //   To ensure messages get to the user fast, we will emit every full line we receive.
    const proc = child_process.spawn(commandAndArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell: true,
      cwd: options.cwd,
      env: options.env,
    });

    const eventPublisher: EventPublisher = options.eventPublisher ?? ((type, line) => {
      switch (type) {
        case 'data_stdout':
          process.stdout.write(line);
          return;
        case 'data_stderr':
          process.stderr.write(line);
          return;
        case 'open':
        case 'close':
          return;
      }
    });

    const stderr = new Array<string>();

    proc.stdout.pipe(split()).on('data', (line) => eventPublisher('data_stdout', line));
    proc.stderr.pipe(split()).on('data', (line) => {
      stderr.push(line);
      return eventPublisher('data_stderr', line);
    });

    proc.on('error', fail);

    proc.on('exit', code => {
      if (code === 0) {
        return ok();
      } else {
        let cause: Error | undefined;
        if (stderr.length) {
          cause = new Error(stderr.join('\n'));
          cause.name = 'ExecutionError';
        }
        return fail(AssemblyError.withCause(`${commandAndArgs}: Subprocess exited with error ${code}`, cause));
      }
    });
  });
}
