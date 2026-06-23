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
 * async_hooks resource types that are noise in a "why won't the process exit"
 * report: created in large numbers and effectively never the handle a user can
 * act on.
 */
const SKIP_TYPES: ReadonlySet<string> = new Set([
  'PROMISE',
  'PerformanceObserver',
  'RANDOMBYTESREQUEST',
]);

/**
 * Plain-language descriptions for Node's async resource types (the fixed set in
 * V8/libuv's async_wrap providers). The raw type is always shown; a description
 * is appended when we have one, so any future/unknown type still reports
 * truthfully.
 */
const TYPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  TCPWRAP: 'open network connection',
  TCPSERVERWRAP: 'listening TCP server',
  TCPSOCKETWRAP: 'open network connection',
  TCPCONNECTWRAP: 'pending outbound TCP connection',
  PIPEWRAP: 'open pipe',
  PIPESERVERWRAP: 'listening pipe server',
  PIPECONNECTWRAP: 'pending pipe connection',
  UDPWRAP: 'open UDP socket',
  UDPSENDWRAP: 'pending UDP send',
  TLSWRAP: 'open TLS connection',
  TTYWRAP: 'open terminal stream',
  TIMERWRAP: 'internal timer holding the loop open',
  Timeout: 'timer from setTimeout or setInterval',
  Immediate: 'pending setImmediate callback',
  FSREQCALLBACK: 'pending file-system operation',
  FSREQPROMISE: 'pending file-system operation',
  FSEVENTWRAP: 'file-system watcher',
  STATWATCHER: 'file-system stat watcher',
  PROCESSWRAP: 'spawned child process still running',
  ChildProcess: 'spawned child process still running',
  GETADDRINFOREQWRAP: 'pending DNS lookup',
  GETNAMEINFOREQWRAP: 'pending DNS reverse lookup',
  QUERYWRAP: 'pending DNS query',
  HTTPCLIENTREQUEST: 'in-flight HTTP request',
  HTTPINCOMINGMESSAGE: 'incoming HTTP message',
  HTTP2SESSION: 'open HTTP/2 connection',
  HTTP2STREAM: 'open HTTP/2 request stream',
  HTTP2PING: 'pending HTTP/2 ping',
  HTTP2SETTINGS: 'pending HTTP/2 settings',
  WRITEWRAP: 'pending stream write',
  SHUTDOWNWRAP: 'pending stream shutdown',
  SIGNALWRAP: 'OS signal handler still registered',
  WORKER: 'worker thread still running',
  MESSAGEPORT: 'open worker-thread message channel',
  ZLIB: 'open (de)compression stream',
  DNSCHANNEL: 'DNS resolver holding sockets open',
  ELDHISTOGRAM: 'event-loop-delay monitor (perf_hooks)',
  FILEHANDLE: 'open file handle',
  FILEHANDLECLOSEREQ: 'pending file-handle close',
  HEAPSNAPSHOT: 'heap snapshot being written',
  JSSTREAM: 'custom JavaScript-backed stream',
  JSUDPWRAP: 'custom JavaScript-backed UDP socket',
  KEYPAIRGENREQUEST: 'pending key-pair generation',
  KEYGENREQUEST: 'pending key generation',
  KEYEXPORTREQUEST: 'pending key export',
  CIPHERREQUEST: 'pending cipher operation',
  DERIVEBITSREQUEST: 'pending key-derivation',
  HASHREQUEST: 'pending hash operation',
  SIGNREQUEST: 'pending sign operation',
  VERIFYREQUEST: 'pending verify operation',
  HTTPPARSER: 'HTTP parser for an open connection',
  INSPECTORJSBINDING: 'debugger/inspector session attached',
  SCRYPTREQUEST: 'pending scrypt operation',
  PBKDF2REQUEST: 'pending PBKDF2 operation',
};

/**
 * A single location in a stack trace: the function name plus the file and line
 * it points to. The function name matters in the shipped CLI, where everything
 * is bundled into one file, so the file:line alone can't tell two frames apart.
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
 * Tracks async resources via async_hooks and, on demand, reports the ones still
 * keeping the event loop alive together with where they were created.
 *
 * The cost lands only when opted in: tracking is off until `start()` is called.
 */
class LeakedHandleTracker {
  private readonly watched = new Map<number, WatchedResource>();

  private readonly hook = createHook({
    init: (asyncId, type, _triggerAsyncId, resource) => {
      if (SKIP_TYPES.has(type)) {
        return;
      }
      this.watched.set(asyncId, {
        type,
        handleRef: new WeakRefImpl(resource as { hasRef?(): boolean }),
        creationStack: captureCreationStack(),
      });
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
  public start = (): void => {
    this.hook.enable();
  };

  /**
   * Stop watching and discard all tracked state.
   *
   * @internal exposed only so tests can isolate the shared singleton.
   */
  public reset = (): void => {
    this.hook.disable();
    this.watched.clear();
  };

  /**
   * Report every resource still holding the event loop open, each with the
   * source location where it was created. Call at the very end of execution, by
   * which point only genuinely leaked handles should remain.
   */
  public report = async (ioHelper: IoHelper): Promise<void> => {
    this.hook.disable();

    const leaks = [...this.watched.values()].filter((r) => {
      const handle = r.handleRef.deref();
      // Already garbage collected, so no longer keeping the loop alive.
      if (handle === undefined) {
        return false;
      }
      return handle.hasRef?.() ?? true;
    });
    this.watched.clear();

    await ioHelper.defaults.info(`${leaks.length} ${leaks.length === 1 ? 'handle' : 'handles'} still keeping the CLI process alive:`);
    for (const leak of leaks) {
      await this.describe(leak, ioHelper);
    }
  };

  private async describe(leak: WatchedResource, ioHelper: IoHelper): Promise<void> {
    const frames = actionableFrames(leak.creationStack);

    await ioHelper.defaults.info('');
    const description = TYPE_DESCRIPTIONS[leak.type];
    const heading = description ? `# ${leak.type} (${description})` : `# ${leak.type}`;
    await ioHelper.defaults.info(chalk.bold(heading));

    if (frames.length === 0) {
      await ioHelper.defaults.info('  (no application stack frames)');
      return;
    }

    // The first frame is where the handle was created; the rest is the call
    // path that led there. We show the function name and the line of code, not
    // the file: the shipped CLI is bundled into a single file, so the file name
    // is always the same and tells the reader nothing.
    const [origin, ...callers] = frames;
    await ioHelper.defaults.info(`  created in ${origin.func}()`);
    const source = sourceAt(origin);
    if (source) {
      await ioHelper.defaults.info(`    ${source}`);
    }
    for (const caller of callers) {
      await ioHelper.defaults.info(`    called from ${caller.func}()`);
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
  }
}

/**
 * Keep only frames the user can act on by dropping Node internals. Our own
 * `init` frame is already removed at capture time (see captureCreationStack).
 */
function actionableFrames(frames: SourceFrame[]): SourceFrame[] {
  return frames.filter((frame) => frame.file && !frame.file.startsWith('node:'));
}

function sourceAt(frame: SourceFrame): string | undefined {
  try {
    const line = readFileSync(frame.file, 'utf-8').split(/\r?\n/)[frame.line - 1]?.trim() || undefined;
    // The shipped CLI is one bundled file where a few lines are huge minified
    // blobs (one is ~600k chars). Truncate so a creation site on such a line
    // doesn't dump the whole blob; the location alone is still useful.
    return line && line.length > 200 ? `${line.slice(0, 200)}…` : line;
  } catch {
    // The source file may not be readable (e.g. a bundled or eval'd frame).
    // The location is still useful on its own, so reporting continues without it.
    return undefined;
  }
}

const tracker = new LeakedHandleTracker();

/**
 * Start tracking async resources. See {@link LeakedHandleTracker.start}.
 */
export const enableHandleTracking = tracker.start;

/**
 * Report handles still keeping the loop alive. See {@link LeakedHandleTracker.report}.
 */
export const reportLeakedHandles = tracker.report;

/**
 * Stop tracking and discard all state.
 *
 * @internal exposed only so tests can isolate the shared singleton.
 */
export const resetHandleTracking = tracker.reset;
