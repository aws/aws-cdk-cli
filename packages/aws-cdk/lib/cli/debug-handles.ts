import { createHook } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as chalk from 'chalk';
import type { IoHelper } from '../../lib/api-private';

// WeakRef exists at runtime on all supported Node versions; reach it via
// globalThis since the package's ES2020 lib predates its type.
type WeakRefConstructor = new <T extends object>(value: T) => { deref(): T | undefined };
const WeakRefImpl = (globalThis as unknown as { WeakRef: WeakRefConstructor }).WeakRef;

/**
 * The async resource types we track, mapped to a plain-language description.
 *
 * This is an allowlist of libuv *handles* — the things that can actually hold
 * the event loop open — and it deliberately excludes *requests* (a pending DNS
 * lookup, a stream write) and bookkeeping resources. Two reasons:
 *
 * - Requests are transient. By the time the report runs they have completed, so
 *   tracking them costs a stack capture per resource and reports nothing.
 * - The volume is the cost. `PROMISE` and `TickObject` alone are created tens of
 *   thousands of times in a single synth, and a stack capture is ~60x the cost
 *   of the bookkeeping around it.
 *
 * The trade-off of an allowlist is that a handle type we don't know about is
 * invisible. That is the right way round for this tool: a missed exotic handle
 * costs one unexplained hang, whereas tracking everything makes the flag too
 * slow to leave on and buries the real leak in noise.
 *
 * Before adding a type, check that it can actually hold the loop open. Only the
 * `HandleWrap`-backed types expose `hasRef()`, so anything else is reported
 * unconditionally — which is right for `TLSWRAP` and `HTTP2SESSION`, whose whole
 * job is to sit on a socket that does hold the loop, and wrong for e.g.
 * `FILEHANDLE` or `DNSCHANNEL`, which never hold it and so only add noise.
 */
const TRACKED_TYPES: Readonly<Record<string, string>> = {
  TCPWRAP: 'open network connection',
  TCPSERVERWRAP: 'listening TCP server',
  TLSWRAP: 'open TLS connection',
  PIPEWRAP: 'open pipe',
  PIPESERVERWRAP: 'listening pipe server',
  UDPWRAP: 'open UDP socket',
  TTYWRAP: 'open terminal stream',
  Timeout: 'timer from setTimeout or setInterval',
  Immediate: 'pending setImmediate callback',
  PROCESSWRAP: 'spawned child process still running',
  FSEVENTWRAP: 'file-system watcher',
  STATWATCHER: 'file-system stat watcher',
  SIGNALWRAP: 'OS signal handler still registered',
  WORKER: 'worker thread still running',
  MESSAGEPORT: 'open worker-thread message channel',
  HTTP2SESSION: 'open HTTP/2 connection',
};

/**
 * How many stack frames to capture per resource.
 *
 * Node's default (`Error.stackTraceLimit`, 10) is far too shallow here: a socket
 * opened by an HTTP agent sits behind ~9 frames of `node:internal/async_hooks`,
 * `node:net`, `node:_http_agent` and `node:tls` before any CLI code appears, so
 * every frame gets filtered as an internal and the report has nothing to show.
 */
const STACK_CAPTURE_DEPTH = 60;

/**
 * A single stack frame: the function name (used for the report heading), plus
 * the file and line, which we read to show the line of code that created the
 * handle.
 */
interface SourceFrame {
  readonly func: string;
  readonly file: string;
  readonly line: number;
}

/**
 * A resource we are watching: a weak reference to the handle (so tracking does
 * not itself keep it alive) and the stack of where it was created.
 */
interface WatchedResource {
  readonly type: string;
  readonly handleRef: { deref(): { hasRef?(): boolean } | undefined };
  readonly creationStack: SourceFrame[];
}

/**
 * Grace period before the handle report fires. The timer is unref'd, so it
 * never fires when Node exits cleanly within this window.
 */
const HANDLE_DUMP_GRACE_MS = 1000;

/**
 * Tracks async resources via async_hooks and, on demand, reports the ones still
 * keeping the event loop alive together with where they were created.
 *
 * The cost lands only when opted in: nothing is tracked until `start()` is
 * called, which `trackLeakedHandles()` does.
 */
export class LeakedHandleTracker {
  private readonly watched = new Map<number, WatchedResource>();

  private readonly hook = createHook({
    init: (asyncId, type, _triggerAsyncId, resource) => {
      if (!(type in TRACKED_TYPES)) {
        return;
      }
      // An exception thrown from an async_hooks callback is not catchable by the
      // application: Node prints "Error in AsyncHook callback" and aborts the
      // process. A diagnostic must never be able to kill the process it is
      // observing, so anything that goes wrong here costs us one handle's
      // provenance and nothing more.
      try {
        this.watched.set(asyncId, {
          type,
          handleRef: new WeakRefImpl(resource as { hasRef?(): boolean }),
          creationStack: captureCreationStack(),
        });
      } catch {
        this.watched.delete(asyncId);
      }
    },
    destroy: (asyncId) => {
      this.watched.delete(asyncId);
    },
  });

  /**
   * Begin watching async resources. Must run before the resources we care about
   * are created, and only when the user opted in — the hook adds a small
   * per-resource cost.
   */
  public start(): void {
    this.hook.enable();
  }

  /**
   * Stop watching and discard all tracked state.
   */
  public stop(): void {
    this.hook.disable();
    this.watched.clear();
  }

  /**
   * Report the leaked handles once the grace period has passed, which is the
   * only way this report should ever be triggered: if the process exits cleanly
   * within the window the timer never fires, and because it is unref'd it does
   * not hold the process open itself.
   */
  public scheduleReport(ioHelper: IoHelper): void {
    setTimeout(() => {
      void this.report(ioHelper);
    }, HANDLE_DUMP_GRACE_MS).unref();
  }

  /**
   * Report every resource still holding the event loop open, each with the
   * source location where it was created. Call at the very end of execution, by
   * which point only genuinely leaked handles should remain.
   *
   * Emitted at DEBUG, not INFO: this is debugging detail, and nothing reaches
   * here unless the user passed `--debug-cli`, which raises the CLI log level to
   * DEBUG for exactly this reason.
   */
  public async report(ioHelper: IoHelper): Promise<void> {
    this.hook.disable();

    const leaks = [...this.watched.values()].filter((r) => {
      const handle = r.handleRef.deref();
      // Already garbage collected, so no longer keeping the loop alive.
      if (handle === undefined) {
        return false;
      }
      // Only HandleWrap-backed types can tell us whether they are holding the
      // loop. The rest (TLSWRAP, HTTP2SESSION) are reported unverified — they sit
      // on a socket that does hold it, and TLSWRAP is the leak behind #1217, so
      // dropping the unverifiable ones would hide the case this flag exists for.
      return handle.hasRef?.() ?? true;
    });
    this.watched.clear();

    if (leaks.length === 0) {
      // This report only runs because the process was still alive after the
      // grace period, so something *is* holding the loop open. Finding nothing
      // means the leak is outside what we track, not that there is no leak.
      await ioHelper.defaults.debug('The CLI process is still alive, but no tracked handle explains it.');
      await ioHelper.defaults.debug('The cause may be a handle opened before tracking started, or a type this build does not track.');
      return;
    }

    await ioHelper.defaults.debug(`${leaks.length} ${leaks.length === 1 ? 'handle' : 'handles'} still keeping the CLI process alive:`);

    // One report pass can revisit the same file for every frame of every handle.
    // In a bundled CLI that file is tens of megabytes, so read each one once.
    const sources = new SourceCache();
    for (const leak of leaks) {
      await this.describe(leak, ioHelper, sources);
    }
  }

  private async describe(leak: WatchedResource, ioHelper: IoHelper, sources: SourceCache): Promise<void> {
    const frames = actionableFrames(leak.creationStack);

    await ioHelper.defaults.debug('');
    await ioHelper.defaults.debug(chalk.bold(`# ${leak.type} (${TRACKED_TYPES[leak.type]})`));

    if (frames.length === 0) {
      await ioHelper.defaults.debug('  (opened entirely inside Node internals, no CLI frames to show)');
      return;
    }

    // Headline the function only when it has a real name; sockets often open
    // from anonymous internal callbacks where the name says nothing.
    const [origin] = frames;
    if (origin.func && origin.func !== '<anonymous>') {
      await ioHelper.defaults.debug(`  created in ${origin.func}()`);
    }

    await ioHelper.defaults.debug('  call stack:');
    for (const frame of frames) {
      // Always print the location. It is the part that identifies the frame, so
      // a frame whose file we cannot read must still appear.
      await ioHelper.defaults.debug(`    ${frame.func} (${frame.file}:${frame.line})`);
      const source = sources.lineAt(frame);
      if (source) {
        await ioHelper.defaults.debug(`      ${chalk.dim(source)}`);
      }
    }
  }
}

/**
 * Capture the call site of the current async resource as structured frames.
 *
 * We install a structured `prepareStackTrace` formatter, capture (using this
 * function as the cut-off so neither it nor the async hook appears), then
 * restore the previous formatter so we don't disturb anyone else's stacks.
 *
 * `captureStackTrace` removes this function and everything above it, but the
 * caller is the tracker's own `init` hook, which sits just below it and would
 * otherwise show up as the top frame. We drop that one frame by position rather
 * than by filename, since after bundling every frame shares the same file name.
 */
function captureCreationStack(): SourceFrame[] {
  const carrier: { stack?: SourceFrame[] } = {};

  // `Error.prepareStackTrace` is a V8 formatting hook we save and restore, not a
  // method we invoke, so the unbound-method concern does not apply here.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const previous = Error.prepareStackTrace;
  const previousLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = STACK_CAPTURE_DEPTH;
  Error.prepareStackTrace = (_error, callSites) => callSites.map((site) => {
    const file = site.getFileName() ?? '';
    return {
      func: site.getFunctionName() ?? '<anonymous>',
      file: file.startsWith('file://') ? fileURLToPath(file) : file,
      line: site.getLineNumber() ?? 0,
    };
  });
  try {
    Error.captureStackTrace(carrier, captureCreationStack);
    // Drop the `init` hook frame (always the top one) so reports point at the
    // application code that created the resource, not at this tracker.
    return carrier.stack?.slice(1) ?? [];
  } finally {
    Error.prepareStackTrace = previous;
    Error.stackTraceLimit = previousLimit;
  }
}

/**
 * Keep only frames the user can act on by dropping Node internals. Our own
 * `init` frame is already removed at capture time (see captureCreationStack).
 */
function actionableFrames(frames: SourceFrame[]): SourceFrame[] {
  return frames.filter((frame) => frame.file && !frame.file.startsWith('node:'));
}

/**
 * Reads the line of code behind a stack frame, holding each file's lines so a
 * report pass reads any given file at most once.
 *
 * This matters more than it looks: the published CLI is a single bundle of over
 * half a million lines, and a report can hold dozens of frames pointing into it.
 * Re-reading and re-splitting per frame turns the report into a multi-second
 * stall, at the exact moment the user is already waiting on a hung CLI.
 */
class SourceCache {
  private readonly files = new Map<string, string[] | undefined>();

  public lineAt(frame: SourceFrame): string | undefined {
    const line = this.linesOf(frame.file)?.[frame.line - 1]?.trim() || undefined;
    // Truncate so an unexpectedly long line (e.g. a generated or packed file)
    // doesn't flood the report.
    return line && line.length > 200 ? `${line.slice(0, 200)}…` : line;
  }

  private linesOf(file: string): string[] | undefined {
    if (!this.files.has(file)) {
      this.files.set(file, readLines(file));
    }
    return this.files.get(file);
  }
}

function readLines(file: string): string[] | undefined {
  try {
    return readFileSync(file, 'utf-8').split(/\r?\n/);
  } catch {
    // The source file may not be readable (e.g. a bundled or eval'd frame). The
    // location is still reported on its own, so reporting continues without it.
    return undefined;
  }
}

/**
 * Start watching async resources and return the tracker doing so.
 *
 * Call this as early as possible, and only when the user asked for it: the
 * tracker can only report on resources created after it starts.
 */
export function trackLeakedHandles(): LeakedHandleTracker {
  const tracker = new LeakedHandleTracker();
  tracker.start();
  return tracker;
}
