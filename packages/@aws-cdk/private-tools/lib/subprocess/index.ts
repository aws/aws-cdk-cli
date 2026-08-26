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
 *
 * As a corollary, migrated runtime consumers do not escape values *for a shell*
 * and then execute them, with one audited exception: `quoteShellPart` in
 * toolkit-lib's `cloud-assembly/environment.ts`, which quotes the file paths
 * this codebase discovers itself before splicing them into the user's `app`
 * command line for `runUserCommandLine`. That is the only quoting-for-execution
 * boundary among these consumers; it is documented at that call site and kept
 * out of this module, whose `renderForDisplay` output is never executed.
 */
import * as child_process from 'child_process';
import { StringDecoder } from 'string_decoder';
import spawn from 'cross-spawn';

/**
 * Which output stream a piece of subprocess output arrived on.
 */
export type OutputStream = 'stdout' | 'stderr';

/**
 * Receives subprocess output as it is produced, for streams that are piped
 * (both streams in 'capture' mode, stdout only in 'inherit-stderr' mode,
 * neither in 'inherit' mode).
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
   * - 'inherit-stderr': pipe stdout (delivered/collected as in 'capture') but
   *   hand the parent's terminal to the child for stderr, so interactive tools
   *   (npm, pip, dotnet) keep progress bars and color. `onOutput` never fires
   *   for stderr and collected stderr is empty.
   * - 'inherit': hand the parent's terminal to the child for both streams.
   *   `onOutput` is not called and the result's `stdout`/`stderr` are empty.
   *
   * @default 'capture'
   */
  readonly stdio?: 'capture' | 'inherit-stderr' | 'inherit';

  /**
   * Called with output as it is produced, for piped streams.
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

  /**
   * Whether to collect piped output into the RunResult / SubprocessError.
   *
   * Pass false for long-running processes whose output is consumed via
   * `onOutput` only (e.g. app synthesis) — otherwise the entire output is
   * retained in memory for the lifetime of the call.
   *
   * @default true
   */
  readonly collect?: boolean;
}

export interface RunResult {
  /**
   * Collected stdout (empty when not piped or `collect: false`).
   */
  readonly stdout: string;

  /**
   * Collected stderr (empty when not piped or `collect: false`).
   */
  readonly stderr: string;
}

/**
 * How a subprocess failed.
 *
 * - 'spawn-failed': the process never started (e.g. executable not found);
 *   `exitCode` and `signal` are null and `cause` carries the OS error.
 * - 'exited': the process ran and exited with a non-zero `exitCode`.
 * - 'killed': the process was terminated by a signal (including timeouts);
 *   `signal` is set.
 */
export type SubprocessFailureKind = 'spawn-failed' | 'exited' | 'killed';

export interface SubprocessErrorProps {
  /** The command, rendered for display. */
  readonly command: string;
  /** Exit code, or `null` if the process was killed or never spawned. */
  readonly exitCode: number | null;
  /** Terminating signal, or `null` if the process exited or never spawned. */
  readonly signal: NodeJS.Signals | null;
  /** Collected stdout up to the failure (empty when not piped or not collected). */
  readonly stdout: string;
  /** Collected stderr up to the failure (empty when not piped or not collected). */
  readonly stderr: string;
  /** The underlying spawn failure, if the process never started. */
  readonly cause?: unknown;
}

/**
 * Raised when a subprocess could not be spawned, was killed, or exited non-zero.
 *
 * Deliberately neutral: adapters in each package re-wrap this into their own
 * error type (`ToolkitError`, `ProcessFailed`, `AssemblyError`, …). Consumers
 * that need to distinguish failure modes should switch on `kind` rather than
 * null-sniffing `exitCode`/`signal`.
 */
export class SubprocessError extends Error {
  public readonly code = 'SUBPROCESS_FAILED';
  public readonly kind: SubprocessFailureKind;
  public readonly command: string;
  public readonly exitCode: number | null;
  public readonly signal: NodeJS.Signals | null;
  public readonly stdout: string;
  public readonly stderr: string;

  constructor(props: SubprocessErrorProps) {
    const kind: SubprocessFailureKind = props.exitCode != null ? 'exited' : props.signal != null ? 'killed' : 'spawn-failed';
    super(subprocessErrorMessage(kind, props), props.cause !== undefined ? { cause: props.cause } : undefined);
    this.kind = kind;
    this.command = props.command;
    this.exitCode = props.exitCode;
    this.signal = props.signal;
    this.stdout = props.stdout;
    this.stderr = props.stderr;
  }
}

function subprocessErrorMessage(kind: SubprocessFailureKind, props: SubprocessErrorProps): string {
  switch (kind) {
    case 'exited':
      return `${props.command} exited with error code ${props.exitCode}`;
    case 'killed':
      return `${props.command} exited with signal ${props.signal}`;
    case 'spawn-failed':
      // Duck-typed rather than `instanceof Error`: Node-internal errno errors
      // come from the host realm and fail instanceof under test sandboxes.
      return `${props.command} failed to start: ${errorMessage(props.cause)}`;
  }
}

function errorMessage(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    return String((cause as { message: unknown }).message);
  }
  return String(cause);
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
  assertNonEmptyArgv(argv, 'run');
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
 *
 * stderr is discarded; stdout is returned. Throws `SubprocessError` on
 * non-zero exit, signal (including timeout kills), or spawn failure.
 */
export function runSync(argv: readonly string[], options: RunSyncOptions = {}): string {
  assertNonEmptyArgv(argv, 'runSync');
  const result = spawn.sync(argv[0], argv.slice(1), {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    killSignal: 'SIGTERM',
    encoding: 'utf-8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  // On timeout, spawnSync sets `error` (ETIMEDOUT) even though the process ran
  // and was signal-killed; classify by signal/status first so a timeout is
  // reported as 'killed', not as a spawn failure.
  if (result.status === 0) {
    return result.stdout;
  }
  throw new SubprocessError({
    command: renderForDisplay(argv),
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: '',
    cause: result.error,
  });
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

function assertNonEmptyArgv(argv: readonly string[], fn: string): void {
  if (argv.length === 0 || !argv[0]) {
    throw new Error(`${fn}() requires a non-empty argv`);
  }
}

function spawnOptions(options: RunOptions): child_process.SpawnOptions {
  const stdio = options.stdio ?? 'capture';
  const stdin = options.input != null ? 'pipe' : 'ignore';
  return {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv | undefined,
    timeout: options.timeoutMs,
    killSignal: 'SIGTERM',
    // Do not flash a console window when the CLI is invoked from a GUI
    // context on Windows (exec() used to default to this; spawn() does not).
    windowsHide: true,
    stdio: [
      stdin,
      stdio === 'inherit' ? 'inherit' : 'pipe',
      stdio === 'capture' ? 'pipe' : 'inherit',
    ],
  };
}

function monitor(child: child_process.ChildProcess, displayCommand: string, options: RunOptions): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const collect = options.collect ?? true;
    const stdout = new Array<string>();
    const stderr = new Array<string>();
    let settled = false;

    const emit = options.onOutput ?? (() => {
    });
    const lines = options.buffering === 'lines' ? lineBuffer(emit) : undefined;

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    if (options.input != null) {
      // A child that exits before draining its stdin (or that never spawns)
      // destroys the stream mid-write; without a listener that EPIPE would
      // escape as an uncaughtException and kill the whole process. The write
      // failure itself is not an error condition for us — the child's exit
      // code / spawn error is authoritative and arrives via 'close'/'error'.
      child.stdin!.on('error', () => {
      });
      child.stdin!.write(options.input);
      child.stdin!.end();
    }

    // Decode per-stream with a stateful decoder: a multi-byte UTF-8 character
    // split across two pipe chunks must not decode to U+FFFD replacement chars.
    const attach = (stream: NodeJS.ReadableStream | null, name: OutputStream, into: string[]) => {
      if (!stream) {
        return;
      }
      const decoder = new StringDecoder('utf-8');
      stream.on('data', (chunk: Buffer) => {
        const data = decoder.write(chunk);
        if (!data) {
          return; // chunk ended mid-character; residue is buffered in the decoder
        }
        if (collect) {
          into.push(data);
        }
        lines ? lines.write(name, data) : emit(name, data);
      });
      stream.on('end', () => {
        const rest = decoder.end();
        if (!rest) {
          return;
        }
        if (collect) {
          into.push(rest);
        }
        lines ? lines.write(name, rest) : emit(name, rest);
      });
    };

    attach(child.stdout, 'stdout', stdout);
    attach(child.stderr, 'stderr', stderr);

    child.once('error', (cause) => {
      settle(() => reject(new SubprocessError({
        command: displayCommand,
        exitCode: null,
        signal: null,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        cause,
      })));
    });

    child.once('close', (exitCode, signal) => {
      lines?.flush();
      settle(() => {
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
  });
}

/**
 * Buffer raw chunks into whole lines per stream, flushing residue on close.
 *
 * Data with no newline at all is appended to a residue list without
 * re-scanning previously buffered text, so pathological newline-free output
 * stays O(n) instead of O(n²).
 */
function lineBuffer(emit: OutputHandler) {
  const residue: Record<OutputStream, string[]> = { stdout: [], stderr: [] };
  return {
    write(stream: OutputStream, data: string) {
      if (!data.includes('\n')) {
        residue[stream].push(data);
        return;
      }
      const parts = (residue[stream].join('') + data).split(/\r?\n/);
      residue[stream] = [parts.pop()!];
      for (const line of parts) {
        emit(stream, line);
      }
    },
    flush() {
      for (const stream of ['stdout', 'stderr'] as const) {
        const rest = residue[stream].join('');
        if (rest) {
          emit(stream, rest);
          residue[stream] = [];
        }
      }
    },
  };
}
