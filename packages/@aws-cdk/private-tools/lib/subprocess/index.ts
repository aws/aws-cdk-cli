/**
 * Shared subprocess execution for the CDK toolchain.
 *
 * Every child process in this repository is spawned in exactly one of two shapes:
 *
 * 1. `run(argv)` — an argv-array spawn with **no shell**. No shell ever parses
 *    the arguments, so shell injection is impossible by construction.
 *    Windows `.cmd`/`.bat` shims (npm, yarn, …) are handled by cross-spawn,
 *    which spawns `cmd.exe /d /s /c` with correct quoting — modern Node does
 *    not spawn batch shims directly (CVE-2024-27980). The executable name is
 *    resolved against PATH.
 *
 * 2. `runUserCommandLine(line)` — an opaque command line passed to the platform
 *    shell verbatim. It is the only path to a shell. The line is usually one the
 *    user themselves authored (e.g. the `app` command from `cdk.json`, the
 *    `--browser` flag) and trusted as such, but callers may also assemble it
 *    from filesystem-discovered parts (see `toolkit-lib`'s `environment.ts`).
 *    Every part spliced into a shell line MUST go through that module's
 *    `quoteShellPart`, which quotes for the platform shell and rejects inputs
 *    that cannot be quoted safely (e.g. a `%VAR%` on Windows, which cmd.exe
 *    expands even inside quotes). This is a property of the callers, not
 *    enforced at this boundary.
 */
// eslint-disable-next-line no-restricted-imports -- this module IS the sanctioned wrapper around child_process
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
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
  const command = resolveExecutable(argv[0], { env: options.env });
  if (command === undefined) {
    return Promise.reject(notFoundError(argv));
  }
  const child = spawn(command, argv.slice(1), spawnOptions(options));
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
  const command = resolveExecutable(argv[0], {});
  if (command === undefined) {
    throw notFoundError(argv);
  }
  const result = spawn.sync(command, argv.slice(1), {
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
    // eslint-disable-next-line no-restricted-syntax -- this is the single sanctioned shell entry point (see the module header)
    shell: true,
  });
  return monitor(child, commandLine, options);
}

/**
 * Resolve an executable name to an absolute path against PATH — never the cwd.
 *
 * On Windows a bare program name spawned without a shell is searched for in the
 * current working directory *before* PATH, so a file planted in the working
 * directory (e.g. a `docker.bat` inside a handed-over cloud assembly) can run
 * instead of the real binary. Resolving to an *absolute* PATH hit up front
 * closes that: the returned path is always absolute (so cross-spawn re-resolves
 * it against nothing), the cwd is never consulted, and a name that is not on
 * PATH is refused (returns `undefined`) rather than silently satisfied from the
 * cwd.
 *
 * Because the guarantee is "the cwd is never consulted", a *relative* PATH
 * entry (classically `.`) is skipped rather than honored: joining `command`
 * onto it would produce a non-absolute candidate that cross-spawn would then
 * re-resolve against the child's cwd — reopening the exact shadowing hole.
 * Quoted PATH entries (`"C:\Program Files\..."`, legal on Windows) are
 * unwrapped, matching what `which` does, so an installed tool is still found.
 *
 * POSIX `execvp` already searches PATH only (never the cwd), so there the name
 * is returned unchanged. An argument that already contains a path separator is
 * an explicit location and is honored verbatim on every platform.
 *
 * @returns the resolved command (absolute on Windows, unchanged elsewhere), or
 *   `undefined` when a bare Windows name cannot be found on PATH.
 */
export function resolveExecutable(
  command: string,
  options: { readonly env?: Record<string, string | undefined>; readonly platform?: NodeJS.Platform } = {},
): string | undefined {
  const platform = options.platform ?? process.platform;

  // An explicit path (absolute, or containing a separator / drive) is used
  // verbatim; there is no PATH search to harden. `\\` is checked directly
  // because path.isAbsolute uses the *running* platform's rules.
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return command;
  }

  // POSIX execvp searches PATH only; nothing to harden.
  if (platform !== 'win32') {
    return command;
  }

  const env = options.env ?? process.env;
  const exts = windowsExtensions(command, envValue(env, 'PATHEXT'));
  const dirs = (envValue(env, 'PATH') ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    // Windows PATH entries may be wrapped in double quotes; unwrap them (as
    // `which` does) so a quoted directory still matches on disk.
    .map(stripSurroundingQuotes)
    // Only absolute entries: a relative one (e.g. `.`) would be joined into a
    // non-absolute candidate that resolves against the cwd — the thing we
    // refuse to consult.
    .filter(isAbsolutePathEntry);

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      if (isFile(candidate)) {
        // Absolute (dir is absolute), so cross-spawn will not re-search.
        return candidate;
      }
    }
  }
  // Not on PATH. Deliberately do NOT fall back to the bare name: that would let
  // Windows resolve it from the cwd, which is exactly the risk we are closing.
  return undefined;
}

/** Strip a single pair of wrapping double quotes from a PATH entry, if present. */
function stripSurroundingQuotes(dir: string): string {
  return /^".*"$/.test(dir) ? dir.slice(1, -1) : dir;
}

/**
 * Whether a PATH entry is absolute. Recognizes both POSIX-absolute and
 * Windows-absolute forms directly, rather than relying on `path.isAbsolute`
 * (which uses the *running* platform's rules) — the resolver must behave the
 * same under the `platform: 'win32'` test override on a POSIX host.
 */
function isAbsolutePathEntry(dir: string): boolean {
  return path.isAbsolute(dir) // running-platform rule (native runtime + POSIX-absolute test dirs)
    || /^[a-zA-Z]:[\\/]/.test(dir) // C:\ or C:/
    || dir.startsWith('\\\\') // UNC \\server\share
    || dir.startsWith('\\') // drive-relative-but-rooted \dir
    || dir.startsWith('/'); // forward-slash absolute
}

/** Look up an environment variable case-insensitively (the Windows env is). */
function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  if (env[name] !== undefined) {
    return env[name];
  }
  const lower = name.toLowerCase();
  const key = Object.keys(env).find((k) => k.toLowerCase() === lower);
  return key !== undefined ? env[key] : undefined;
}

/**
 * The extensions to append when searching for `command` on Windows.
 *
 * If the name already ends in a known executable extension, search for it
 * exactly (empty suffix). Otherwise, if the name contains a dot it may itself
 * be a literal file on PATH, so probe the exact name first (as Windows and
 * cross-spawn's `which` do) before appending each PATHEXT entry.
 */
function windowsExtensions(command: string, pathext: string | undefined): string[] {
  const configured = (pathext ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean);
  const lower = command.toLowerCase();
  if (configured.some((e) => lower.endsWith(e.toLowerCase()))) {
    return [''];
  }
  return command.includes('.') ? ['', ...configured] : configured;
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * A `SubprocessError` shaped like a real spawn ENOENT, for the case where a
 * bare Windows name could not be resolved on PATH. Keeps `kind: 'spawn-failed'`
 * and a `cause` carrying `code: 'ENOENT'` so downstream guidance (e.g.
 * cdk-assets' "please install docker") still fires.
 */
function notFoundError(argv: readonly string[]): SubprocessError {
  const cause = Object.assign(new Error(`spawn ${argv[0]} ENOENT`), {
    code: 'ENOENT', errno: -2, syscall: 'spawn', path: argv[0],
  });
  return new SubprocessError({
    command: renderForDisplay(argv),
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    cause,
  });
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
