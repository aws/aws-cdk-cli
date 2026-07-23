/**
 * Shared subprocess execution for the CDK toolchain.
 *
 * Every child process in this repository is spawned in exactly one of two shapes:
 *
 * 1. `run(argv)` — an argv-array spawn with **no shell**. No shell ever parses
 *    the arguments, so shell injection is impossible by construction.
 *    Windows `.cmd`/`.bat` shims (npm, yarn, …) are handled by cross-spawn,
 *    which spawns `cmd.exe /d /s /c` with correct quoting — modern Node does
 *    not spawn batch shims directly (CVE-2024-27980).
 *
 * 2. `runUserCommandLine(line)` — an opaque command line **the user themselves
 *    authored** (e.g. the `app` command from `cdk.json`, the `--browser` flag),
 *    passed to the platform shell verbatim. The shell is the documented feature
 *    here and the input is trusted by definition; this function is deliberately
 *    the only path to a shell and takes no argv form, so command lines can
 *    never be assembled from parts by this codebase.
 */
import * as child_process from 'child_process';
import spawn from 'cross-spawn';

/**
 * Which output stream a piece of subprocess output arrived on.
 */
export type OutputStream = 'stdout' | 'stderr';

/**
 * Receives subprocess output as it is produced (only in 'capture' mode).
 */
export type OutputHandler = (stream: OutputStream, data: string) => void;

export interface RunOptions {
  /**
   * Working directory for the child process.
   *
   * @default - the current working directory
   */
  readonly cwd?: string;

  /**
   * Full environment for the child process.
   *
   * Same semantics as `child_process.spawn`: when given, it *replaces* the
   * environment (callers that want to extend should spread `process.env`).
   *
   * @default process.env
   */
  readonly env?: Record<string, string | undefined>;

  /**
   * String to pipe to the child's stdin, after which stdin is closed.
   *
   * @default - stdin is ignored
   */
  readonly input?: string;

  /**
   * Kill the child with SIGTERM after this many milliseconds.
   *
   * The resulting failure surfaces as a `SubprocessError` with `signal` set.
   *
   * @default - no timeout
   */
  readonly timeoutMs?: number;

  /**
   * How to wire the child's stdout/stderr.
   *
   * - 'capture' (default): pipe both streams; deliver output to `onOutput` and
   *   collect it into the result / error.
   * - 'inherit': hand the parent's terminal to the child. `onOutput` is not
   *   called and the result's `stdout`/`stderr` are empty.
   *
   * @default 'capture'
   */
  readonly stdio?: 'capture' | 'inherit';

  /**
   * Called with output as it is produced (only in 'capture' mode).
   *
   * @default - output is only collected into the result
   */
  readonly onOutput?: OutputHandler;

  /**
   * Delivery granularity for `onOutput`.
   *
   * - 'chunks' (default): deliver data exactly as received from the pipe.
   * - 'lines': buffer and deliver whole lines (without the newline); any
   *   unterminated residue is flushed when the child closes.
   *
   * @default 'chunks'
   */
  readonly buffering?: 'chunks' | 'lines';
}

export interface RunResult {
  /**
   * Collected stdout (empty in 'inherit' mode).
   */
  readonly stdout: string;

  /**
   * Collected stderr (empty in 'inherit' mode).
   */
  readonly stderr: string;
}

export interface SubprocessErrorProps {
  /** The command, rendered for display. */
  readonly command: string;
  /** Exit code, or `null` if the process was killed or never spawned. */
  readonly exitCode: number | null;
  /** Terminating signal, or `null` if the process exited or never spawned. */
  readonly signal: NodeJS.Signals | null;
  /** Collected stdout up to the failure (empty in 'inherit' mode). */
  readonly stdout: string;
  /** Collected stderr up to the failure (empty in 'inherit' mode). */
  readonly stderr: string;
  /** The underlying spawn failure, if the process never started. */
  readonly cause?: unknown;
}

/**
 * Raised when a subprocess could not be spawned, was killed, or exited non-zero.
 *
 * Deliberately neutral: adapters in each package re-wrap this into their own
 * error type (`ToolkitError`, `ProcessFailed`, `AssemblyError`, …).
 */
export class SubprocessError extends Error {
  public readonly code = 'SUBPROCESS_FAILED';
  public readonly command: string;
  public readonly exitCode: number | null;
  public readonly signal: NodeJS.Signals | null;
  public readonly stdout: string;
  public readonly stderr: string;

  constructor(props: SubprocessErrorProps) {
    super(subprocessErrorMessage(props), props.cause !== undefined ? { cause: props.cause } : undefined);
    this.command = props.command;
    this.exitCode = props.exitCode;
    this.signal = props.signal;
    this.stdout = props.stdout;
    this.stderr = props.stderr;
  }
}

function subprocessErrorMessage(props: SubprocessErrorProps): string {
  if (props.exitCode != null) {
    return `${props.command} exited with error code ${props.exitCode}`;
  }
  if (props.signal != null) {
    return `${props.command} exited with signal ${props.signal}`;
  }
  return `${props.command} failed to start: ${props.cause instanceof Error ? props.cause.message : props.cause}`;
}

/**
 * Run a program with the given arguments, without a shell.
 *
 * The safe default for everything the codebase spawns itself (docker, npm,
 * git, asset bundlers, etc.). Arguments are passed to the OS as an argv array and
 * are never parsed by a shell, so no escaping is needed and shell injection is
 * impossible. Windows `.cmd`/`.bat` shims are resolved by cross-spawn.
 *
 * Resolves with the collected output on exit code 0; rejects with
 * `SubprocessError` otherwise.
 */
export async function run(argv: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  if (argv.length === 0 || !argv[0]) {
    throw new Error('run() requires a non-empty argv');
  }
  const child = spawn(argv[0], argv.slice(1), spawnOptions(options));
  return monitor(child, renderForDisplay(argv), options);
}

export interface RunSyncOptions {
  /**
   * Working directory for the child process.
   *
   * @default - the current working directory
   */
  readonly cwd?: string;

  /**
   * Kill the child with SIGTERM after this many milliseconds.
   *
   * @default - no timeout
   */
  readonly timeoutMs?: number;
}

/**
 * Synchronous variant of `run()` for the rare call sites that cannot be async.
 */
export function runSync(argv: readonly string[], options: RunSyncOptions = {}): string {
  if (argv.length === 0 || !argv[0]) {
    throw new Error('runSync() requires a non-empty argv');
  }
  const result = spawn.sync(argv[0], argv.slice(1), {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    killSignal: 'SIGTERM',
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error) {
    throw new SubprocessError({
      command: renderForDisplay(argv),
      exitCode: null,
      signal: null,
      stdout: result.stdout ?? '',
      stderr: '',
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new SubprocessError({
      command: renderForDisplay(argv),
      exitCode: result.status,
      signal: result.signal,
      stdout: result.stdout ?? '',
      stderr: '',
    });
  }
  return result.stdout;
}

/**
 * Run a command line the user themselves authored, through the platform shell.
 *
 * This is the ONLY way this codebase reaches a shell, and it deliberately has
 * no argv form: the command line must arrive as the single opaque string the
 * user configured (`cdk.json` `app`, `--browser`, init template hooks). Shell
 * features in that string (pipes, `&&`, variable expansion) are the documented
 * contract, and the trust boundary is the user's own configuration.
 *
 * Do NOT build the command line by concatenating values. If you have separate
 * arguments, you want `run()`.
 */
export async function runUserCommandLine(commandLine: string, options: RunOptions = {}): Promise<RunResult> {
  const child = child_process.spawn(commandLine, {
    ...spawnOptions(options),
    shell: true,
  });
  return monitor(child, commandLine, options);
}

/**
 * Render an argv array as a single string for logs and error messages.
 *
 * DISPLAY ONLY — this is not a security mechanism and its output should never be
 * executed. Nothing in this module ever passes a rendered string to a shell;
 * quoting exists purely so a human reading a log can tell where one argument
 * ends and the next begins.
 */
export function renderForDisplay(argv: readonly string[], platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? argv.map(windowsDisplayEscape).join(' ')
    : argv.map(posixDisplayEscape).join(' ');
}

/**
 * Characters that never need quoting for display, on any platform.
 *
 * Everything else — including every POSIX and cmd.exe metacharacter (`;`, `|`,
 * `&`, `<`, `>`, `(`, `)`, backtick, `*`, `^`, `%`, quotes, whitespace, …) —
 * triggers quoting. An allowlist cannot miss a metacharacter the way the
 * denylists it replaces did.
 */
const DISPLAY_SAFE = /^[A-Za-z0-9_%+=:,.@/-]+$/;

function posixDisplayEscape(x: string): string {
  if (DISPLAY_SAFE.test(x)) {
    return x;
  }
  // Single quotes make everything literal; embedded single quotes become '"'"'
  return `'${x.replace(/'/g, '\'"\'"\'')}'`;
}

function windowsDisplayEscape(x: string): string {
  if (DISPLAY_SAFE.test(x.replace(/\\/g, '/')) && !x.includes('%')) {
    return x;
  }
  // MSVC argv quoting: double quotes around the argument, backslashes double
  // only when they precede a quote, embedded quotes are backslash-escaped.
  let escaped = x.replace(/(\\*)"/g, '$1$1\\"');
  escaped = escaped.replace(/(\\+)$/, '$1$1');
  return `"${escaped}"`;
}

function spawnOptions(options: RunOptions): child_process.SpawnOptions {
  const capture = (options.stdio ?? 'capture') === 'capture';
  const stdin = options.input != null ? 'pipe' : 'ignore';
  return {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv | undefined,
    timeout: options.timeoutMs,
    killSignal: 'SIGTERM',
    stdio: [stdin, capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
  };
}

function monitor(child: child_process.ChildProcess, displayCommand: string, options: RunOptions): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const stdout = new Array<string>();
    const stderr = new Array<string>();

    const emit = options.onOutput ?? (() => {
    });
    const lines = options.buffering === 'lines' ? lineBuffer(emit) : undefined;

    if (options.input != null) {
      child.stdin!.write(options.input);
      child.stdin!.end();
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const data = chunk.toString('utf-8');
      stdout.push(data);
      lines ? lines.write('stdout', data) : emit('stdout', data);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const data = chunk.toString('utf-8');
      stderr.push(data);
      lines ? lines.write('stderr', data) : emit('stderr', data);
    });

    child.once('error', (cause) => {
      reject(new SubprocessError({
        command: displayCommand,
        exitCode: null,
        signal: null,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        cause,
      }));
    });

    child.once('close', (exitCode, signal) => {
      lines?.flush();
      if (exitCode === 0) {
        resolve({ stdout: stdout.join(''), stderr: stderr.join('') });
      } else {
        reject(new SubprocessError({
          command: displayCommand,
          exitCode,
          signal,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
        }));
      }
    });
  });
}

/**
 * Buffer raw chunks into whole lines per stream, flushing residue on close.
 */
function lineBuffer(emit: OutputHandler) {
  const residue: Record<OutputStream, string> = { stdout: '', stderr: '' };
  return {
    write(stream: OutputStream, data: string) {
      const parts = (residue[stream] + data).split(/\r?\n/);
      residue[stream] = parts.pop()!;
      for (const line of parts) {
        emit(stream, line);
      }
    },
    flush() {
      for (const stream of ['stdout', 'stderr'] as const) {
        if (residue[stream]) {
          emit(stream, residue[stream]);
          residue[stream] = '';
        }
      }
    },
  };
}
