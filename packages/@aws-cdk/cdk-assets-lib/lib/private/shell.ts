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

  /**
   * Command-line flags whose immediately-following argument may carry a secret
   * and must be masked wherever the command line is surfaced to a human (the
   * `open`/`close` events and any failure message). The process still receives
   * the real value — only the *display* is redacted.
   *
   * Example: `['--build-arg', '--secret']` turns `--build-arg TOKEN=abc123`
   * into `--build-arg TOKEN=<redacted>` in logs.
   *
   * @default - nothing is redacted
   */
  readonly redactFlags?: readonly string[];
}

/**
 * OS helpers
 *
 * Executes the given command as an argv array (never through a shell) and
 * returns its stdout, routing intermediate output to the configured
 * destination.
 */
export async function shell(command: string[], options: ShellOptions): Promise<string> {
  const displayCommand = renderForDisplay(redactSensitiveArgs(command, options.redactFlags));
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
      // `e.message` embeds the raw (un-redacted) command that `run()` rendered.
      // Swap that prefix for our redacted display so secrets don't leak into
      // the failure message. A function replacement avoids `$`-pattern issues.
      const message = e.message.replace(e.command, () => displayCommand);
      throw new ProcessFailed(
        e.exitCode,
        e.signal,
        stderr ? `${message}: ${stderr}` : message,
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
/**
 * Return a copy of `argv` with the value after each redact-flag masked.
 *
 * Only the returned array is ever rendered for display; the original `argv` is
 * what actually runs. The key portion of a `key=value` token is kept (it is not
 * the secret and aids debugging); everything after the first `=` — or the whole
 * token if there is no `=` — is replaced.
 */
function redactSensitiveArgs(argv: readonly string[], redactFlags?: readonly string[]): string[] {
  if (!redactFlags || redactFlags.length === 0) {
    return [...argv];
  }
  const flags = new Set(redactFlags);
  const out = new Array<string>();
  for (let i = 0; i < argv.length; i++) {
    out.push(argv[i]);
    if (flags.has(argv[i]) && i + 1 < argv.length) {
      i += 1;
      const token = argv[i];
      const eq = token.indexOf('=');
      out.push(eq >= 0 ? `${token.slice(0, eq + 1)}<redacted>` : '<redacted>');
    }
  }
  return out;
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
