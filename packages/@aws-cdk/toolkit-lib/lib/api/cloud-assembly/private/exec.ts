import * as child_process from 'node:child_process';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import split = require('split2');
import { ToolkitError } from '../../../toolkit/toolkit-error';
import type { CommandLine } from '../command-line';

type EventPublisher = (event: 'open' | 'data_stdout' | 'data_stderr' | 'close', line: string) => void;

interface ExecOptions {
  eventPublisher?: EventPublisher;
  env?: { [key: string]: string | undefined };
  cwd?: string;
}

/**
 * Execute a command and args in a child process
 *
 * @param command - The command to execute
 * @param args - Optional arguments for the command
 * @param options - Additional options for execution
 */
export async function execInChildProcess(cmd: CommandLine, options: ExecOptions = {}) {
  const commandLineString = cmd.toStringGrouped();

  return new Promise<void>((ok, fail) => {
    // We use a slightly lower-level interface to:
    //
    // - Pass arguments in an array instead of a string, to get around a
    //   number of quoting issues introduced by the intermediate shell layer
    //   (which would be different between Linux and Windows).
    //
    // - We have to capture any output to stdout and stderr sp we can pass it on to the IoHost
    //   To ensure messages get to the user fast, we will emit every full line we receive.
    const proc = child_process.spawn(commandLineString, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      cwd: options.cwd,
      env: options.env,

      // We are using 'shell: true' on purprose. Traditionally we have allowed shell features in
      // this string, so we have to continue to do so into the future. On Windows, this is simply
      // necessary to run .bat and .cmd files properly.
      // Code scanning tools will flag this as a risk. The input comes from a trusted source,
      // so it does not represent a security risk.
      shell: true,
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
    proc.stdout.pipe(split()).on('data', (line) => eventPublisher('data_stdout', line));
    proc.stderr.pipe(split()).on('data', (line) => eventPublisher('data_stderr', line));

    proc.on('error', fail);

    proc.on('exit', code => {
      if (code === 0) {
        return ok();
      } else {
        return fail(new ToolkitError(`${commandLineString}: Subprocess exited with error ${code}`));
      }
    });
  });
}
