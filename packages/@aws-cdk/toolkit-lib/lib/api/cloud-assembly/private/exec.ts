import * as child_process from 'node:child_process';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import split = require('split2');
import { AssemblyError } from '../../../toolkit/toolkit-error';
import { Readable } from 'node:stream';

type EventPublisher = (event: 'open' | 'data_stdout' | 'data_stderr' | 'close', line: string) => void;

interface ExecOptions {
  eventPublisher?: EventPublisher;
  env?: { [key: string]: string | undefined };
  cwd?: string;
}

export type Command =
  | { type: 'argv'; argv: string[] }
  | { type: 'shell'; command: string }
  ;

/**
 * Turn a user input into a `Command` type
 */
export function toCommand(input: string | string[]): Command {
  if (Array.isArray(input)) {
    return { type: 'argv', argv: input };
  } else {
    return { type: 'shell', command: input };
  }
}

export function renderCommand(command: Command): string {
  switch (command.type) {
    case 'shell':
      return command.command;
    case 'argv':
      return JSON.stringify(command.argv);
  }
}

/**
 * Execute a command line in a child process
 */
export async function execInChildProcess(command: Command, options: ExecOptions = {}) {
  return new Promise<void>((ok, fail) => {
    // Depending on the type of command we have to execute, spawn slightly differently
    let proc : child_process.ChildProcessByStdio<null, Readable, Readable>;
    const spawnOpts: child_process.SpawnOptionsWithStdioTuple<child_process.StdioNull, child_process.StdioPipe, child_process.StdioPipe> = {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      cwd: options.cwd,
      env: options.env,
    };

    switch (command.type) {
      case 'argv':
        proc = child_process.spawn(command.argv[0], command.argv.slice(1), spawnOpts);
        break;
      case 'shell':
        proc = child_process.spawn(command.command, {
          ...spawnOpts,
          // Command lines need a shell; necessary on windows for .bat and .cmd files, necessary on
          // Linux to use the shell features we've traditionally supported.
          // Code scanning tools will flag this as a risk. The input comes from a trusted source,
          // so it does not represent a security risk.
          shell: true,
        });
        break;
    }

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
        return fail(AssemblyError.withCause(`${renderCommand(command)}: Subprocess exited with error ${code}`, cause));
      }
    });
  });
}
