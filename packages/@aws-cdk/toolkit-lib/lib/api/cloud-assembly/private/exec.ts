import { readFileSync } from 'fs';
import { runUserCommandLine, SubprocessError } from '../../../private/tools';
import { AssemblyError } from '../../../toolkit/toolkit-error';

type EventPublisher = (event: 'open' | 'data_stdout' | 'data_stderr' | 'close', line: string) => void;

interface ExecOptions {
  eventPublisher?: EventPublisher;
  env?: { [key: string]: string | undefined };
  cwd?: string;
  errorCodeFile?: string;

  /**
   * Whether to capture output and send it into the event publisher, or stdout if no event publisher is supplied.
   *
   * @default true
   */
  captureOutput?: boolean;
}

/**
 * Execute a command line in a child process
 *
 * Based on the errors it throws, this assumes the process it is executing is a CDK app.
 */
export async function execInChildProcess(commandAndArgs: string, options: ExecOptions = {}) {
  const captureOutput = options.captureOutput ?? true;

  const eventPublisher: EventPublisher = options.eventPublisher ?? ((type, line) => {
    switch (type) {
      case 'data_stdout':
        process.stdout.write(line + '\n');
        return;
      case 'data_stderr':
        process.stderr.write(line + '\n');
        return;
      case 'open':
      case 'close':
        return;
    }
  });

  const stderr = new Array<string>();

  try {
    // The command line is the user's own `app`/`build` setting. Traditionally
    // we have allowed shell features in this string, so it runs through the
    // shell verbatim; on Windows the shell is also what resolves .bat and .cmd
    // files. Code scanning tools will flag this as a risk: the input comes
    // from a trusted source (the user's own configuration), so it does not
    // represent a security risk.
    //
    // Output is captured and re-emitted per full line, so messages get to the
    // user fast and the IoHost receives whole lines.
    await runUserCommandLine(commandAndArgs, {
      stdio: captureOutput ? 'capture' : 'inherit',
      buffering: 'lines',
      onOutput: (stream, line) => {
        if (stream === 'stderr') {
          stderr.push(line);
        }
        eventPublisher(stream === 'stdout' ? 'data_stdout' : 'data_stderr', line);
      },
      cwd: options.cwd,
      env: {
        // On Windows, Python will default to cp1252 when not connected to a terminal, but we
        // expect it to be UTF-8 below (to be able to split on lines).
        PYTHONIOENCODING: 'utf-8',
        ...options.env,
      },
    });
  } catch (e: any) {
    if (!(e instanceof SubprocessError)) {
      throw e;
    }

    // The process never spawned (e.g. the shell itself could not start)
    if (e.exitCode == null && e.signal == null) {
      throw AssemblyError.withCause(`Failed to execute CDK app: ${commandAndArgs}`, e.cause ?? e);
    }

    const stdErrString = stderr.join('\n');

    let cause: Error | undefined;
    if (stderr.length) {
      cause = new Error(stdErrString);
      cause.name = 'ExecutionError';
    }

    const error = AssemblyError.withCause(`${commandAndArgs}: Subprocess exited with error ${e.exitCode ?? e.signal}`, cause);

    // Search for an error code, and throw that if we have it
    if (options.errorCodeFile) {
      const contents = tryReadFile(options.errorCodeFile);
      if (contents) {
        const errorInStdErr = contents.split('\n')[0];

        if (errorInStdErr) {
          // Attach the synth error code. We don't need to change the message; the underlying error will already have been
          // printed to stderr.
          error.attachSynthesisErrorCode(errorInStdErr);
        }
      }
    }

    throw error;
  }
}

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
