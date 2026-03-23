import * as child_process from 'child_process';
import { readFileSync } from 'fs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import split = require('split2');
import { AssemblyError } from '../../../toolkit/toolkit-error';

type EventPublisher = (event: 'open' | 'data_stdout' | 'data_stderr' | 'close', line: string) => void;

interface ExecOptions {
  eventPublisher?: EventPublisher;
  env?: { [key: string]: string | undefined };
  cwd?: string;
  errorCodeFile?: string;
}

/**
 * Execute a command line in a child process
 *
 * Based on the errors it throws, this assumes the process it is executing is a CDK app.
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

    const stderr = new Array<string>();

    proc.stdout.pipe(split()).on('data', (line) => eventPublisher('data_stdout', line));
    proc.stderr.pipe(split()).on('data', (line) => {
      stderr.push(line);
      return eventPublisher('data_stderr', line);
    });

    proc.on('error', (e) => {
      fail(AssemblyError.withCause(`Failed to execute CDK app: ${commandAndArgs}`, e));
    });

    proc.on('exit', code => {
      if (code === 0) {
        return ok();
      } else {
        const stdErrString = stderr.join('\n');

        let cause: Error | undefined;
        if (stderr.length) {
          cause = new Error(stdErrString);
          cause.name = 'ExecutionError';
        }

        let error = AssemblyError.withCause(`${commandAndArgs}: Subprocess exited with error ${code}`, cause);

        // Search for an error code, and throw that if we have it
        if (options.errorCodeFile) {
          const contents = tryReadFile(options.errorCodeFile);
          if (contents) {
            const errorInStdErr = contents
              .split('\n')
              .find(c => stdErrString.includes(`${SYNTH_ERROR_CODE_MARKERS[0]}${c}${SYNTH_ERROR_CODE_MARKERS[1]}`));

            if (errorInStdErr) {
              // Attach the synth error code. We don't need to change the message; the underlying error will already have been
              // printed to stderr.
              error.attachSynthesisErrorCode(errorInStdErr);
            }
          }
        }

        return fail(error);
      }
    });
  });
}

const SYNTH_ERROR_CODE_MARKERS = ['«', '»'];

function tryReadFile(name: string): string | undefined {
  try {
    return readFileSync(name, 'utf-8');
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return undefined;
    }
    throw e;
  }
}
