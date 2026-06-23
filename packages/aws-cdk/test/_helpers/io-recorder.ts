import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IoMessage, IoMessageLevel, IoRequest } from '../../lib/api';
import { isMessageRelevantForLevel } from '../../lib/api-private';
import type { IoMessageObservation, ObservableIoHost } from '../../lib/cli/io-host';

/**
 * Matches ANSI SGR (color/style) escape sequences produced by chalk.
 */
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/**
 * A scrubber replaces non-deterministic content in a string so that snapshots
 * stay stable across runs (e.g. durations, timestamps, absolute paths).
 */
export interface Scrubber {
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * Default scrubbers applied to every recorded message (and to serialized data).
 *
 * These exist to keep snapshots deterministic. They intentionally err on the
 * side of being specific so they don't accidentally mangle stable content like
 * stack names.
 */
function defaultScrubbers(): Scrubber[] {
  return [
    // ISO-8601 timestamps, e.g. 2026-06-22T13:20:32.185Z
    { pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, replacement: '<TIME>' },
    // Durations like "0.52s", "12.0s" or "0s" (e.g. "Synthesis time: 0.52s")
    { pattern: /\b\d+(?:\.\d+)?s\b/g, replacement: '<DURATION>' },
    // V8 stack-trace frames ("    at fn (file:line:col)") — when an Error is
    // formatted into a message its stack is non-deterministic; drop the frames
    // so only the stable "Error: <message>" line remains.
    { pattern: /\n\s+at\s+[^\n]*/g, replacement: '' },
    // The OS temp dir (tests chdir into a temp dir)
    { pattern: new RegExp(escapeRegExp(fs.realpathSync(os.tmpdir())), 'g'), replacement: '<TMP>' },
  ];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A single message captured at the `CliIoHost` boundary, normalized into a
 * stable, snapshot-friendly shape.
 *
 * The field order here is deliberate: it is the order the keys appear in each
 * NDJSON line, which keeps diffs readable.
 */
export interface RecordedIoEntry {
  /**
   * Chronological sequence number within the test (0-based).
   */
  readonly seq: number;

  /**
   * Whether the message was sent via `notify` or `requestResponse`.
   */
  readonly type: 'notify' | 'request';

  /**
   * The toolkit action that was active when the message was emitted.
   */
  readonly action?: string;

  /**
   * The recommended log level of the message, *after* any listener overrides.
   */
  readonly level: string;

  /**
   * The message code, or `null` for generic (code-less) messages.
   */
  readonly code: string | null;

  /**
   * The fully formatted, ANSI-stripped, scrubbed message text, *after* any
   * listener rewrites.
   */
  readonly message: string;

  /**
   * Whether a listener prevented this message from being written (the user
   * would not see it). Omitted when the message is written normally.
   *
   * @default - omitted (the message is written)
   */
  readonly dropped?: boolean;

  /**
   * For `request` entries: the response the IoHost resolved with.
   *
   * @default - omitted for `notify` entries
   */
  readonly response?: unknown;
}

export interface IoHostRecorderOptions {
  /**
   * The minimum level a message must have to be included in the snapshot.
   *
   * This is the single place where we decide which levels end up in the snap.
   * It is intentionally owned by the recorder and is *independent of the host's*
   * `logLevel`: the recorder always *receives* every message (it records at the
   * notify boundary, upstream of the host's own level filtering) and then this
   * threshold decides what gets serialized.
   *
   * Uses the same "at or above" semantics as the rest of the toolkit
   * (`isMessageRelevantForLevel`). The default `'trace'` includes everything.
   *
   * @default 'trace' - include messages of every level
   */
  readonly level?: IoMessageLevel;

  /**
   * Additional scrubbers applied on top of the defaults.
   *
   * @default - only the default scrubbers
   */
  readonly scrubbers?: Scrubber[];
}

/**
 * Records every message sent to a `CliIoHost` (or any `IIoHost`) during a test
 * and snapshots them as newline-delimited JSON (NDJSON).
 *
 * # Why
 *
 * When we move a command (e.g. `cdk destroy`) from the legacy `CdkToolkit` onto
 * the `toolkit-lib` `Toolkit`, the *behavior* should be identical but the exact
 * sequence of IO messages flowing to the user is easy to change by accident
 * (this is how the `cdk list` reroute regressed). By capturing the full ordered
 * stream of messages at the IoHost boundary as a committed snapshot, any change
 * to that stream shows up as a diff in code review.
 *
 * # How it works
 *
 * The recorder installs `jest.spyOn` on the host's `notify` and
 * `requestResponse` methods to capture the ordered stream of messages (merged
 * via jest's global `invocationCallOrder`).
 *
 * It additionally registers an observer via the host's `observeMessages` hook
 * (when the host implements `ObservableIoHost`, as the `CliIoHost` does) to
 * capture the *effective* disposition of each notified message — i.e. the
 * text/level after any registered listeners have run, and whether a listener
 * prevented it from being written (`dropped`). This makes the snapshot reflect
 * what the user would actually see, so listener-based suppression and level
 * overrides are visible in — and protected by — the snapshot. A plain `IIoHost`
 * that does not implement `ObservableIoHost` still works; the recorder simply
 * falls back to the message as emitted.
 *
 * # Usage
 *
 * The IoHost is a singleton, so there is a single recorder instance per host:
 * `create()` is idempotent and returns the same recorder (installing the spies
 * only once). Jest's `clearMocks` wipes the recorded calls between tests, so
 * the recorder always reflects only the current test's messages.
 *
 * ```ts
 * let recorder: IoHostRecorder;
 * beforeEach(() => {
 *   recorder = IoHostRecorder.create(ioHost);
 * });
 *
 * test('...', async () => {
 *   await toolkit.destroy({ ... });
 *   await recorder.matchSnapshot();
 * });
 * ```
 *
 * Run `yarn jest -u` to create/update the snapshot files. Snapshots are
 * written next to the test file under
 * `__io_snapshots__/<test-file>/<test-name>.ndjson`.
 */
export class IoHostRecorder {
  /**
   * Get (or lazily create) the recorder for the given IoHost by spying on its
   * message methods. Repeated calls for the same host return the same recorder.
   */
  public static create(host: { notify: any; requestResponse: any }, options: IoHostRecorderOptions = {}): IoHostRecorder {
    const existing = IoHostRecorder.cache.get(host);
    if (existing) {
      // Same recorder across the (singleton) host; clear the per-test
      // observation buffer so each test starts fresh.
      existing.resetObservations();
      return existing;
    }
    const notifySpy = jest.spyOn(host as any, 'notify');
    const requestSpy = jest.spyOn(host as any, 'requestResponse');
    const recorder = new IoHostRecorder(notifySpy, requestSpy, options);
    // If the host is observable, capture the effective disposition of each
    // message (text/level after listeners, and whether it was dropped). This is
    // opt-in enrichment via a public interface: any plain `IIoHost` still works,
    // it just won't reflect listener-level changes.
    if (typeof (host as any).observeMessages === 'function') {
      (host as unknown as ObservableIoHost).observeMessages((observation) => {
        recorder.observations.push(observation);
      });
    }
    IoHostRecorder.cache.set(host, recorder);
    return recorder;
  }

  /**
   * One recorder per host instance. Because the CLI IoHost is a singleton,
   * this effectively yields a single shared recorder, and ensures we only
   * install the spies and observer once regardless of how many times `create`
   * is called.
   */
  private static readonly cache = new WeakMap<object, IoHostRecorder>();

  private readonly scrubbers: Scrubber[];
  private readonly level: IoMessageLevel;

  // Effective disposition of each notified message, collected via the host's
  // `observeMessages` hook (empty when the host is not observable).
  private readonly observations: IoMessageObservation[] = [];

  private constructor(
    private readonly notifySpy: jest.SpyInstance,
    private readonly requestSpy: jest.SpyInstance,
    options: IoHostRecorderOptions,
  ) {
    this.scrubbers = [...defaultScrubbers(), ...(options.scrubbers ?? [])];
    this.level = options.level ?? 'trace';
  }

  private resetObservations(): void {
    this.observations.length = 0;
  }

  /**
   * Build the ordered list of recorded entries from the spies.
   */
  public async entries(): Promise<RecordedIoEntry[]> {
    interface Raw {
      order: number;
      type: 'notify' | 'request';
      msg: IoMessage<unknown> | IoRequest<unknown, unknown>;
      result?: jest.MockResult<any>;
    }

    const raw: Raw[] = [];

    this.notifySpy.mock.calls.forEach((args, i) => {
      raw.push({
        order: this.notifySpy.mock.invocationCallOrder[i],
        type: 'notify',
        msg: args[0],
      });
    });

    this.requestSpy.mock.calls.forEach((args, i) => {
      raw.push({
        order: this.requestSpy.mock.invocationCallOrder[i],
        type: 'request',
        msg: args[0],
        result: this.requestSpy.mock.results[i],
      });
    });

    raw.sort((a, b) => a.order - b.order);

    // Map each notified message to the disposition the host computed for it
    // (post-listener text/level + whether it was prevented from being written).
    const disposition = this.dispositionByMessage();

    // Build sequentially. The awaited request promises are already settled by
    // the time we read them, so there is no parallelism to bound here.
    const entries: RecordedIoEntry[] = [];
    let seq = 0;
    for (const r of raw) {
      // For notifications, prefer the post-listener message; fall back to the
      // emitted message when the host did not process it (e.g. notify mocked).
      const effective = (r.type === 'notify' ? disposition.get(r.msg)?.effective : undefined) ?? r.msg;
      const dropped = r.type === 'notify' ? (disposition.get(r.msg)?.dropped ?? false) : false;

      // The single decision point for which levels are included; uses the
      // effective level so listener level-overrides are respected.
      if (!isMessageRelevantForLevel({ level: effective.level }, this.level)) {
        continue;
      }

      const base: RecordedIoEntry = {
        seq: seq++,
        type: r.type,
        action: r.msg.action,
        level: effective.level,
        code: r.msg.code ?? null,
        message: this.normalize(String(effective.message ?? '')),
        ...(dropped ? { dropped: true } : {}),
      };

      if (r.type === 'request') {
        entries.push({ ...base, response: this.scrubValue(await resolveResult(r.result)) });
      } else {
        entries.push(base);
      }
    }
    return entries;
  }

  /**
   * Index the message dispositions captured from the host's `observeMessages`
   * hook by the emitted message object, so notifications can be enriched with
   * their effective form. Empty when the host is not observable, or when it did
   * not process any messages (e.g. `notify` was mocked to a no-op).
   */
  private dispositionByMessage(): Map<object, IoMessageObservation> {
    const map = new Map<object, IoMessageObservation>();
    for (const observation of this.observations) {
      map.set(observation.emitted, observation);
    }
    return map;
  }

  /**
   * Render the recorded entries as NDJSON (one JSON object per line).
   */
  public async toNdjson(): Promise<string> {
    const lines = (await this.entries()).map((e) => JSON.stringify(e));
    return lines.length > 0 ? lines.join('\n') + '\n' : '';
  }

  /**
   * Compare the recorded NDJSON against the on-disk snapshot, creating or
   * updating it when running with `-u` (or in `--ci` mode, failing if missing).
   */
  public async matchSnapshot(name?: string): Promise<void> {
    const actual = await this.toNdjson();
    const file = snapshotFilePath(name);
    const update = updateMode();
    const exists = fs.existsSync(file);

    if (exists && update !== 'all') {
      const expected = fs.readFileSync(file, 'utf-8');
      // Use a string comparison so jest renders a readable line-by-line diff.
      expect(actual).toEqual(expected);
      return;
    }

    if (!exists && update === 'none') {
      throw new Error(
        `IO snapshot is missing and snapshots are not being written (--ci mode): ${file}\n` +
        'Run the tests locally with `-u` and commit the snapshot.',
      );
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, actual);
  }

  private normalize(text: string): string {
    let out = text.replace(ANSI_PATTERN, '');
    for (const s of this.scrubbers) {
      out = out.replace(s.pattern, s.replacement);
    }
    return out;
  }

  private scrubValue(value: unknown): unknown {
    if (value === undefined) {
      return undefined;
    }
    const json = JSON.stringify(value, (_k, v) => (typeof v === 'string' ? this.normalize(v) : v));
    return json === undefined ? undefined : JSON.parse(json);
  }
}

/**
 * Resolve the value a `requestResponse` call produced.
 *
 * `requestResponse` is async, so the recorded mock result value is (usually) a
 * promise. By the time we read it (after the action under test has completed)
 * the promise has settled, so awaiting it is safe and yields the real resolved
 * response. A rejection (e.g. `AbortedByUser`) is captured as its error name.
 */
async function resolveResult(result?: jest.MockResult<any>): Promise<unknown> {
  if (!result) {
    return undefined;
  }
  // Synchronous throw (rare for an async method, but be safe).
  if (result.type === 'throw') {
    return { error: result.value?.name ?? 'Error' };
  }
  const value: unknown = result.value;
  if (value && typeof (value as any).then === 'function') {
    try {
      return value;
    } catch (err: any) {
      return { error: err?.name ?? 'Error' };
    }
  }
  return value;
}

type UpdateMode = 'all' | 'new' | 'none';

/**
 * Mirror jest's own snapshot update behavior so this integrates with the
 * standard `-u` flag and `--ci` mode (no separate env var to remember):
 * - `all`  : `jest -u` — always (re)write the snapshot
 * - `new`  : default — write only if the snapshot doesn't exist yet
 * - `none` : `jest --ci` — never write; a missing snapshot is a failure
 */
function updateMode(): UpdateMode {
  const state: any = (expect as any).getState?.();
  const mode = state?.snapshotState?._updateSnapshot as UpdateMode | undefined;
  return mode ?? 'new';
}

function snapshotFilePath(name?: string): string {
  const state: any = (expect as any).getState?.() ?? {};
  const testPath: string = state.testPath ?? path.join(process.cwd(), 'unknown.test.ts');
  const testName: string = name ?? state.currentTestName ?? 'unnamed';

  const dir = path.join(
    path.dirname(testPath),
    '__io_snapshots__',
    path.basename(testPath).replace(/\.test\.tsx?$/, ''),
  );
  return path.join(dir, sanitize(testName) + '.ndjson');
}

function sanitize(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9-_. ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}
