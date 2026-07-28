import type { SubprocessOutputDestination } from './asset-handler';
import { run, renderForDisplay, SubprocessError } from './tools';

export type ShellEventType = 'open' | 'data_stdout' | 'data_stderr' | 'close';

export type ShellEventPublisher = (event: ShellEventType, message: string) => void;

export interface ShellOptions {
  readonly shellEventPublisher: ShellEventPublisher;
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly input?: string;
  readonly subprocessOutputDestination?: SubprocessOutputDestination;
}

/**
 * OS helpers
 *
 * Executes the given command as an argv array (never through a shell) and
 * returns its stdout, routing intermediate output to the configured
 * destination.
 */
export async function shell(command: string[], options: ShellOptions): Promise<string> {
  const displayCommand = renderForDisplay(command);
  handleShellOutput(displayCommand, options, 'open');

  try {
    const result = await run(command, {
      cwd: options.cwd,
      env: options.env,
      input: options.input,
      onOutput: (stream, data) =>
        handleShellOutput(data, options, stream === 'stdout' ? 'data_stdout' : 'data_stderr'),
    });
    handleShellOutput(displayCommand, options, 'close');
    return result.stdout;
  } catch (e: any) {
    if (e instanceof SubprocessError) {
      // A process that never started has no exit to report; rethrow the OS
      // error (ENOENT, EACCES, …) as-is — callers key off its `code` (e.g.
      // docker.ts turns ENOENT into "please install docker" guidance).
      // No `instanceof Error` on the cause: errno errors come from the host
      // realm and fail instanceof under test sandboxes.
      if (e.kind === 'spawn-failed' && e.cause != null) {
        throw e.cause;
      }
      handleShellOutput(displayCommand, options, 'close');
      const stderr = e.stderr.trim();
      throw new ProcessFailed(
        e.exitCode,
        e.signal,
        stderr ? `${e.message}: ${stderr}` : e.message,
      );
    }
    throw e;
  }
}

function handleShellOutput(
  chunk: string,
  options: ShellOptions,
  shellEventType: ShellEventType,
): void {
  switch (options.subprocessOutputDestination) {
    case 'ignore':
      return;
    case 'publish':
      options.shellEventPublisher(shellEventType, chunk);
      break;
    case 'stdio':
    default:
      switch (shellEventType) {
        case 'data_stdout':
          process.stdout.write(chunk);
          break;
        case 'data_stderr':
          process.stderr.write(chunk);
          break;
        case 'open':
          options.shellEventPublisher(shellEventType, chunk);
          break;
      }
      break;
  }
}
export type ProcessFailedError = ProcessFailed;

class ProcessFailed extends Error {
  public readonly code = 'PROCESS_FAILED';

  constructor(
    public readonly exitCode: number | null,
    public readonly signal: NodeJS.Signals | null,
    message: string,
  ) {
    super(message);
  }
}
