import { createHook } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as chalk from 'chalk';
import type { IoHelper } from '../api-private';

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
 * Every type here must expose `hasRef()`, because that is the only way to tell a
 * handle that is holding the loop open from one that has already been closed. A
 * type without it cannot be checked, and reporting it unchecked is how this
 * report ends up confidently naming things that are not leaks — `TLSWRAP` in
 * particular has no `hasRef()` and never fires its `destroy` hook, so every
 * completed HTTPS request would be listed as a leak forever.
 *
 * Leaving `TLSWRAP` out costs less than it appears to: a leaked TLS connection is
 * still reported, via the `TCPWRAP` underneath it, which does expose `hasRef()`.
 */
const TRACKED_TYPES: Readonly<Record<string, string>> = {
  TCPWRAP: 'open network connection',
  TCPSERVERWRAP: 'listening TCP server',
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
 * Grace period before the handle report fires. The timer is unref'd, so it
 * never fires when Node exits cleanly within this window.
 */
const HANDLE_DUMP_GRACE_MS = 1000;

/**
 * Upper bound on how many resources we hold provenance for at once.
 *
 * A long-lived command (`cdk watch`, a deploy of many stacks) opens and closes
 * handles continuously. Every one costs a stack capture, and while the `destroy`
 * hook normally removes it again, handle types that never fire `destroy` would
 * otherwise accumulate for the life of the process. Capping trades completeness
 * for a bounded footprint, which is the right way round: the report says when it
 * stopped tracking, and the handles that matter for a hang are usually the ones
 * opened early.
 */
const MAX_TRACKED_HANDLES = 10_000;

/**
 * How much of a source line to show beneath a stack frame.
 *
 * Long enough to read a statement, short enough that a single minified line from
 * the bundled CLI (which can be hundreds of kilobytes) cannot flood the report.
 */
const SOURCE_SNIPPET_CHARS = 200;

/**
 * A single stack frame: the function name (used for the report heading), plus
 * the file, line and column, which we use both to print the location and to read
 * back the line of code that created the handle.
 *
 * The column matters more than it looks. In the published CLI every frame points
 * into one bundled, whitespace-minified file, so line numbers alone barely
 * discriminate between frames and the column is the only thing that says *where*
 * on the line the call was.
 */
interface SourceFrame {
  readonly func: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/**
 * A resource we are watching: a weak reference to the handle (so tracking does
 * not itself keep it alive) and the stack of where it was created.
 */
interface WatchedResource {
  readonly type: string;
  readonly handleRef: WeakRef<TrackedHandle>;
  readonly creationStack: SourceFrame[];
}

/**
 * The parts of a libuv handle we interrogate to decide whether it is still
 * holding the event loop open. Both are optional because neither is guaranteed:
 * `hasRef` only exists on `HandleWrap`-backed types, and `_destroyed` is a Node
 * internal that only timers set.
 */
interface TrackedHandle {
  _destroyed?: boolean;
  hasRef?(): boolean;
}

/**
 * Tracks async resources via async_hooks and, on demand, reports the ones still
 * keeping the event loop alive together with where they were created.
 *
 * The cost lands only when opted in: nothing is tracked until `start()` is
 * called, which `trackLeakedHandles()` does. Not exported as a value — the only
 * way to get one is `trackLeakedHandles()`, which guarantees a started tracker.
 */
class LeakedHandleTracker {
  private readonly watched = new Map<number, WatchedResource>();

  /**
   * Whether we stopped recording because {@link MAX_TRACKED_HANDLES} was
   * reached. Reported, so a short list is never mistaken for a complete one.
   */
  private atCapacity = false;

  private readonly hook = createHook({
    init: (asyncId, type, _triggerAsyncId, resource) => {
      if (!(type in TRACKED_TYPES)) {
        return;
      }
      if (this.watched.size >= MAX_TRACKED_HANDLES) {
        this.atCapacity = true;
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
          handleRef: new WeakRef(resource as TrackedHandle),
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
   * only way this report should ever be triggered in production: if the process
   * exits cleanly within the window the timer never fires, and because it is
   * unref'd it does not hold the process open itself.
   */
  public scheduleReport(ioHelper: IoHelper): void {
    setTimeout(() => {
      // This callback runs detached from the CLI's own error handling — by now
      // the command has finished and there is no one left to hand a rejection
      // to. Swallowing is deliberate: a diagnostic that crashes the process it
      // is diagnosing is worse than one that goes quiet.
      this.report(ioHelper).catch(() => undefined);
    }, HANDLE_DUMP_GRACE_MS).unref();
  }

  /**
   * Report every resource still holding the event loop open, each with the
   * source location where it was created. Call at the very end of execution, by
   * which point only genuinely leaked handles should remain.
   *
   * Emitted as one message rather than one per line: the report is a single
   * coherent block, and splitting it lets unrelated output interleave into the
   * middle of a stack trace.
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
      // A fired one-shot timer keeps answering `hasRef() === true` for the rest of
      // the process, and only marks itself `_destroyed`. The `destroy` hook does
      // eventually drop it from `watched`, but a tick later than this, and timers
      // are the CLI's most common resource — so check the flag rather than trust
      // the hook to have landed first.
      if (handle._destroyed === true) {
        return false;
      }
      // Ask the handle itself, and believe only a clear yes. A closed socket
      // answers `false`, and anything that cannot answer is not evidence of a
      // leak — claiming otherwise is how a diagnostic starts lying, which is
      // worse than staying quiet.
      return typeof handle.hasRef === 'function' && handle.hasRef();
    });
    this.watched.clear();

    await ioHelper.defaults.debug(this.renderReport(leaks).join('\n'));
  }

  private renderReport(leaks: WatchedResource[]): string[] {
    if (leaks.length === 0) {
      // This report only runs because the process was still alive after the
      // grace period, so something *is* holding the loop open. Finding nothing
      // means the leak is outside what we track, not that there is no leak, so
      // hand over what Node itself sees rather than just shrugging.
      return [
        'The CLI process is still alive, but no tracked handle explains it.',
        `Node reports these resources still active: ${activeResourceSummary()}`,
        'The cause may be a handle opened before tracking started, or a type this build does not track.',
      ];
    }

    const lines = [`${leaks.length} ${leaks.length === 1 ? 'handle' : 'handles'} still keeping the CLI process alive:`];
    if (this.atCapacity) {
      lines.push(`Stopped recording after ${MAX_TRACKED_HANDLES} handles, so this list may be incomplete.`);
    }

    // One report pass can revisit the same file for every frame of every handle.
    // In a bundled CLI that file is tens of megabytes, so read each one once.
    const sources = new SourceCache();
    for (const leak of leaks) {
      lines.push(...describeLeak(leak, sources));
    }

    if (sources.sawMinifiedLine) {
      // Worth saying outright, because the reader's instinct is to open the file
      // at that line and find the CLI's own source. The published CLI is one
      // bundled and whitespace-minified file with no source map, so a location
      // is a position in the bundle, and the snippet beneath it is the only part
      // that maps back to something recognisable.
      lines.push('');
      lines.push('Locations above are positions in the bundled CLI, not in the original source files.');
    }

    return lines;
  }
}

function describeLeak(leak: WatchedResource, sources: SourceCache): string[] {
  const frames = actionableFrames(leak.creationStack);
  const lines = ['', chalk.bold(`# ${leak.type} (${TRACKED_TYPES[leak.type]})`)];

  if (frames.length === 0) {
    lines.push('  (opened entirely inside Node internals, no CLI frames to show)');
    return lines;
  }

  // Headline the function only when it has a real name; sockets often open
  // from anonymous internal callbacks where the name says nothing.
  const [origin] = frames;
  if (origin.func && origin.func !== '<anonymous>') {
    lines.push(`  created in ${origin.func}()`);
  }

  lines.push('  call stack:');
  for (const frame of frames) {
    // Always print the location. It is the part that identifies the frame, so
    // a frame whose file we cannot read must still appear.
    lines.push(`    ${frame.func} (${frame.file}:${frame.line}:${frame.column})`);
    const snippet = sources.snippetAt(frame);
    if (snippet) {
      lines.push(`      ${chalk.dim(snippet)}`);
    }
  }
  return lines;
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
      column: site.getColumnNumber() ?? 0,
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
 * What Node itself says is still holding the loop open, as `2x Timeout, 1x TCP`.
 *
 * This is the ground truth our own tracking is an attempt to explain, so it is
 * worth printing when the two disagree: it tells the reader whether the tracker
 * missed something or whether the hang is somewhere else entirely.
 */
function activeResourceSummary(): string {
  const counts = new Map<string, number>();
  for (const type of process.getActiveResourcesInfo()) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return '(none)';
  }
  return [...counts].map(([type, count]) => `${count}x ${type}`).join(', ');
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
  /**
   * Whether any line we read was long enough to be minified rather than
   * hand-written. Used to warn that the printed locations are bundle-relative.
   */
  public sawMinifiedLine = false;

  private readonly files = new Map<string, string[] | undefined>();

  public snippetAt(frame: SourceFrame): string | undefined {
    const line = this.linesOf(frame.file)?.[frame.line - 1];
    if (line === undefined) {
      return undefined;
    }
    if (line.length <= SOURCE_SNIPPET_CHARS) {
      return line.trim() || undefined;
    }

    // Too long to be source anyone wrote, so show a window centred on the
    // column. Taking the first N characters instead would, in a bundle, reliably
    // show some unrelated module from the top of the line.
    this.sawMinifiedLine = true;
    const start = Math.max(0, frame.column - 1 - Math.floor(SOURCE_SNIPPET_CHARS / 2));
    const end = Math.min(line.length, start + SOURCE_SNIPPET_CHARS);
    const window = line.slice(start, end).trim();
    return `${start > 0 ? '…' : ''}${window}${end < line.length ? '…' : ''}`;
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

export type { LeakedHandleTracker };
