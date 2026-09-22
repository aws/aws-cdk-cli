import { createHook } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import type { IoHelper } from '../api-private';

/**
 * Async resource types we track, with a plain-language description for the report.
 *
 * Only libuv *handles*, the resources that can hold the event loop open. Requests
 * (a DNS lookup, a stream write) have completed by the time the report runs.
 * `PROMISE` and `TickObject` are excluded on volume alone: they dominate every
 * async resource a synth creates, and each one would cost a stack capture.
 *
 * Every type here exposes `hasRef()`, the only way to tell a handle holding the
 * loop open from one already closed. `TLSWRAP` has neither `hasRef()` nor a
 * `destroy` hook, so including it would report every completed HTTPS request as a
 * leak forever. A leaked TLS connection still surfaces as the `TCPWRAP` under it.
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
 * Node's default of 10 is too shallow here. A socket opened through an HTTPS agent
 * sits behind enough frames of `node:internal/tls/wrap`, `node:https`,
 * `node:_http_agent` and `node:_http_client` to consume that whole budget, leaving
 * no application frame for the report to show.
 */
const STACK_CAPTURE_DEPTH = 60;

/**
 * Grace period before the handle report fires. The timer is unref'd, so it never
 * fires when Node exits cleanly within this window.
 */
const HANDLE_DUMP_GRACE_MS = 1000;

/**
 * Cap on how many resources we hold provenance for at once.
 *
 * A long-lived command (`cdk watch`, a deploy of many stacks) opens and closes
 * handles continuously. The `destroy` hook normally removes them again, but types
 * that never fire it would accumulate for the life of the process. The report says
 * when the cap was hit, so a truncated list is not read as a complete one.
 */
const MAX_TRACKED_HANDLES = 10_000;

/**
 * How much of a source line to show beneath a stack frame. Long enough to read a
 * statement, short enough that one minified line from the bundled CLI cannot
 * flood the report.
 */
const SOURCE_SNIPPET_CHARS = 200;

/**
 * One stack frame: the function name, plus the file, line and column, used both to
 * print the location and to read back the line of code.
 *
 * The column is load-bearing. In the published CLI every frame points into one
 * bundled, whitespace-minified file, where the line number barely distinguishes
 * one frame from another.
 */
interface SourceFrame {
  readonly func: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/**
 * A resource we are watching: a weak reference to the handle, so tracking does not
 * itself keep it alive, and the stack of where it was created.
 */
interface WatchedResource {
  readonly type: string;
  readonly handleRef: WeakRef<TrackedHandle>;
  readonly creationStack: SourceFrame[];
}

/**
 * The parts of a libuv handle we interrogate. Both are optional because neither is
 * guaranteed: `hasRef` exists only on `HandleWrap`-backed types, and `_destroyed`
 * is a Node internal that only timers set.
 */
interface TrackedHandle {
  _destroyed?: boolean;
  hasRef?(): boolean;
}

/**
 * Tracks async resources via async_hooks and, on demand, reports the ones still
 * keeping the event loop alive, with where they were created.
 *
 * Nothing is tracked until `start()` runs. Not exported as a value, so the only
 * way to get one is `trackLeakedHandles()`, which returns a started tracker.
 */
class LeakedHandleTracker {
  private readonly watched = new Map<number, WatchedResource>();

  /**
   * Whether we stopped recording because {@link MAX_TRACKED_HANDLES} was reached.
   * Reported, so a short list is never mistaken for a complete one.
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
      // application. Node prints "Error in AsyncHook callback" and aborts the
      // process, so anything that goes wrong here must cost no more than one
      // handle's provenance.
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
   * are created, and only when the user opted in, since the hook adds a small
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
   * Report the leaked handles once the grace period has passed. The timer is
   * unref'd, so it never fires if the process exits cleanly within the window and
   * never holds the process open itself.
   */
  public scheduleReport(ioHelper: IoHelper): void {
    setTimeout(() => {
      // Runs detached from the CLI's error handling: the command has finished and
      // there is no one left to hand a rejection to. A diagnostic must not crash
      // the process it is diagnosing.
      this.report(ioHelper).catch(() => undefined);
    }, HANDLE_DUMP_GRACE_MS).unref();
  }

  /**
   * Report every resource still holding the event loop open, each with the source
   * location where it was created. Call at the very end of execution, by which
   * point only genuinely leaked handles should remain.
   *
   * Emitted as one message, so unrelated output cannot interleave into the middle
   * of a stack trace, and at DEBUG, which is the level `--debug-cli` raises the
   * CLI to.
   */
  public async report(ioHelper: IoHelper): Promise<void> {
    this.hook.disable();

    const leaks = [...this.watched.values()].filter((r) => {
      const handle = r.handleRef.deref();
      // Already garbage collected, so no longer keeping the loop alive.
      if (handle === undefined) {
        return false;
      }
      // A fired one-shot timer answers `hasRef() === true` for the rest of the
      // process and only marks itself `_destroyed`. The `destroy` hook does drop
      // it from `watched`, but a tick later than this, and timers are the CLI's
      // most common resource.
      if (handle._destroyed === true) {
        return false;
      }
      // Ask the handle itself, and believe only a clear yes. A closed socket
      // answers false, and anything that cannot answer is not evidence of a leak.
      return typeof handle.hasRef === 'function' && handle.hasRef();
    });
    this.watched.clear();

    await ioHelper.defaults.debug(this.renderReport(leaks).join('\n'));
  }

  private renderReport(leaks: WatchedResource[]): string[] {
    if (leaks.length === 0) {
      // This report only runs because the process was still alive, so something
      // is holding the loop open. Finding nothing means the cause is outside what
      // we track, so hand over what Node itself sees.
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

    // One report pass can revisit the same file for every frame of every handle,
    // and in the published CLI that file is the entire bundle.
    const sources = new SourceCache();
    for (const leak of leaks) {
      lines.push(...describeLeak(leak, sources));
    }

    if (sources.sawMinifiedLine) {
      // The published CLI is one bundled, minified file with no source map, so a
      // location is a position in the bundle and the snippet beneath it is the
      // only part that maps back to something recognisable.
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

  // Headline the function only when it has a real name. Sockets often open from
  // anonymous internal callbacks, where the name says nothing.
  const [origin] = frames;
  if (origin.func && origin.func !== '<anonymous>') {
    lines.push(`  created in ${origin.func}()`);
  }

  lines.push('  call stack:');
  for (const frame of frames) {
    // The location is what identifies the frame, so print it even when the file
    // cannot be read.
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
 * Installs a structured `prepareStackTrace`, captures with this function as the
 * cut-off, then restores the previous formatter so other stacks are unaffected.
 *
 * The cut-off removes this function and everything above it, but the caller is the
 * tracker's own `init` hook, which sits just below and would otherwise be the top
 * frame. We drop that frame by position rather than by filename, since after
 * bundling every frame shares one filename.
 */
function captureCreationStack(): SourceFrame[] {
  const carrier: { stack?: SourceFrame[] } = {};

  // `Error.prepareStackTrace` is a V8 formatting hook we save and restore, not a
  // method we invoke, so the unbound-method concern does not apply.
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
    // Drop the `init` hook frame, always the top one, so the report points at the
    // code that created the resource rather than at this tracker.
    return carrier.stack?.slice(1) ?? [];
  } finally {
    Error.prepareStackTrace = previous;
    Error.stackTraceLimit = previousLimit;
  }
}

/**
 * What Node itself reports as still holding the loop open, as `2x Timeout, 1x TCP`.
 *
 * This is the ground truth our own tracking tries to explain, so printing it tells
 * the reader whether we missed something or the hang is somewhere else.
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
 * Keep only frames the user can act on by dropping Node internals. Our own `init`
 * frame is already removed at capture time, see {@link captureCreationStack}.
 */
function actionableFrames(frames: SourceFrame[]): SourceFrame[] {
  return frames.filter((frame) => frame.file && !frame.file.startsWith('node:'));
}

/**
 * Reads the line of code behind a stack frame, holding each file's lines so a
 * report pass reads any given file at most once.
 *
 * The published CLI is one large bundle, and a single report can hold many frames
 * pointing into it. Re-reading and re-splitting it per frame stalls the report, at
 * the moment the user is already waiting on a hung CLI.
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

    // Too long to be source anyone wrote, so show a window centred on the column
    // rather than the start of the line.
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
    // Bundled and eval'd frames have filenames that are not on disk. The location
    // is still reported on its own, so reporting continues without the snippet.
    return undefined;
  }
}

/**
 * Start watching async resources and return the tracker doing so.
 *
 * Call as early as possible, and only when the user asked for it. The tracker can
 * only report on resources created after it starts.
 */
export function trackLeakedHandles(): LeakedHandleTracker {
  const tracker = new LeakedHandleTracker();
  tracker.start();
  return tracker;
}

export type { LeakedHandleTracker };
