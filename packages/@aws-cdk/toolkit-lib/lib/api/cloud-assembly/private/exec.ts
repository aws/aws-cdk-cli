import * as child_process from 'node:child_process';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import split = require('split2');
import { ToolkitError } from '../../../toolkit/toolkit-error';

type EventPublisher = (event: 'open' | 'data_stdout' | 'data_stderr' | 'close', line: string) => void;

interface ExecOptions {
  eventPublisher?: EventPublisher;
  env?: { [key: string]: string | undefined };
  cwd?: string;
}

/**
 * Execute a command and args in a child process
 * @param command The command to execute
 * @param args Optional arguments for the command
 * @param options Additional options for execution
 */
export async function execInChildProcess(command: string, args: string[] = [], options: ExecOptions = {}) {
  return new Promise<void>((ok, fail) => {
    // We use a slightly lower-level interface to:
    //
    // - Pass arguments in an array instead of a string, to get around a
    //   number of quoting issues introduced by the intermediate shell layer
    //   (which would be different between Linux and Windows).
    //
    // - We have to capture any output to stdout and stderr sp we can pass it on to the IoHost
    //   To ensure messages get to the user fast, we will emit every full line we receive.
    const proc = child_process.spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell: false, // Don't use shell to avoid cross-platform issues
      cwd: options.cwd,
      env: options.env,
    });

    const commandDisplay = `${command} ${args.join(' ')}`;
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
        return fail(new ToolkitError(`${commandDisplay}: Subprocess exited with error ${code}`));
      }
    });
  });
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use the version that takes command and args separately
 */
export async function execInChildProcess(commandAndArgs: string, options?: ExecOptions): Promise<void>;
export async function execInChildProcess(commandOrCommandAndArgs: string, argsOrOptions?: string[] | ExecOptions, maybeOptions?: ExecOptions): Promise<void> {
  // Handle the overloaded function signature
  if (Array.isArray(argsOrOptions)) {
    // Called with (command, args, options)
    return execInChildProcessImpl(commandOrCommandAndArgs, argsOrOptions, maybeOptions || {});
  } else {
    // Called with (commandAndArgs, options)
    // This is the legacy path - we need to parse the command string
    const options = argsOrOptions as ExecOptions || {};
    
    // Simple splitting - in a real implementation you'd want to handle quoted arguments properly
    const parts = commandOrCommandAndArgs.split(' ');
    const command = parts[0];
    const args = parts.slice(1);
    
    return execInChildProcessImpl(command, args, options);
  }
}

/**
 * Implementation of execInChildProcess that always takes separate command and args
 */
function execInChildProcessImpl(command: string, args: string[], options: ExecOptions = {}): Promise<void> {
  return new Promise<void>((ok, fail) => {
    const commandDisplay = `${command} ${args.join(' ')}`;
    
    const proc = child_process.spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell: false, // Don't use shell to avoid cross-platform issues
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
    proc.stdout.pipe(split()).on('data', (line) => eventPublisher('data_stdout', line));
    proc.stderr.pipe(split()).on('data', (line) => eventPublisher('data_stderr', line));

    proc.on('error', fail);

    proc.on('exit', code => {
      if (code === 0) {
        return ok();
      } else {
        return fail(new ToolkitError(`${commandDisplay}: Subprocess exited with error ${code}`));
      }
    });
  });
}
