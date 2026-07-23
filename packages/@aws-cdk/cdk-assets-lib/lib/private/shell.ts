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
  handleShellOutput({ chunk: displayCommand, options, shellEventType: 'open' });

  try {
    const result = await run(command, {
      cwd: options.cwd,
      env: options.env,
      input: options.input,
      onOutput: (stream, data) => handleShellOutput({
        chunk: data,
        options,
        shellEventType: stream === 'stdout' ? 'data_stdout' : 'data_stderr',
      }),
    });
    handleShellOutput({ chunk: displayCommand, options, shellEventType: 'close' });
    return result.stdout;
  } catch (e: any) {
    if (e instanceof SubprocessError) {
      handleShellOutput({ chunk: displayCommand, options, shellEventType: 'close' });
      throw new ProcessFailed(
        e.exitCode,
        e.signal,
        `${displayCommand} exited with ${e.exitCode != null ? 'error code' : 'signal'} ${e.exitCode ?? e.signal}: ${e.stderr.trim()}`,
      );
    }
    throw e;
  }
}

interface HandleShellOutputProps {
  /** The output chunk or, for 'open'/'close' events, the rendered command. */
  readonly chunk: string;
  /** The options of the surrounding `shell()` call. */
  readonly options: ShellOptions;
  /** Which event this chunk belongs to. */
  readonly shellEventType: ShellEventType;
}

function handleShellOutput(props: HandleShellOutputProps): void {
  const { chunk, options, shellEventType } = props;
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
