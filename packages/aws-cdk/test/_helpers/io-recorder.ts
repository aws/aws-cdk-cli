import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IoMessageLevel } from '../../lib/api';
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

  /**
   * Omit messages a listener prevented from being written (`dropped`) entirely,
   * so the snapshot contains only what the user actually sees.
   *
   * Set to `false` to keep dropped messages (tagged `"dropped": true`) when you
   * want listener-based suppression to stay visible.
   *
   * @default true
   */
  readonly excludeDropped?: boolean;
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
 * The recorder captures the message stream purely through the host's
 * `observeMessages` hook (the `ObservableIoHost` contract the `CliIoHost`
 * implements). The host reports every message it handles — both `notify`
 * notifications and `requestResponse` requests — in the order it handled them,
 * along with the *effective* disposition of each one: the text/level after any
 * registered listeners ran, whether a listener prevented a notification from
 * being written (`dropped`), and the resolved response for a request.
 *
 * Because the recorder only *observes* and never replaces (`spyOn`) the host's
 * methods, the real `notify`/`requestResponse` always run. This is what makes
 * it robust: a test's `jest.resetAllMocks()` has nothing of the recorder's to
 * neuter, so the recorder needs no per-test pass-through boilerplate, and the
 * real request path runs — so listeners (e.g. a `respondOnce`/`--force`
 * auto-confirm) are honored exactly as in production. Answer prompts in tests
 * with `ioHost.respondOnce(IO.<code>, value)` rather than by spying on
 * `requestResponse`.
 *
 * The host must implement `ObservableIoHost`; the `CliIoHost` does. (This is a
 * CLI-internal test helper, and every recorded host is a `CliIoHost`.)
 *
 * # Dropped (suppressed) messages
 *
 * A notification a listener suppressed via `preventDefault` (e.g. the CLI drops
 * toolkit-lib's synth-time line on the `--json list` path) is *recorded* and
 * tagged `"dropped": true`. This is deliberate: listener-based suppression is
 * exactly the kind of user-facing behavior the snapshot exists to protect, so a
 * change to what is suppressed must show up as a snapshot diff. Dropped entries
 * are therefore part of the committed snapshot, not noise to be filtered out.
 *
 * # Usage
 *
 * The IoHost is a singleton, so there is a single recorder instance per host:
 * `create()` is idempotent, returns the same recorder (registering the observer
 * only once), and clears the per-test observation buffer, so the recorder
 * always reflects only the current test's messages.
 *
 * ```ts
 * let recorder: IoHostRecorder;
 * beforeEach(() => {
 *   recorder = IoHostRecorder.create(ioHost);
 * });
 *
 * test('destroys after confirmation', async () => {
 *   // Answer the confirmation prompt the real way: a one-shot responder, so
 *   // the real requestResponse runs and the request is recorded.
 *   ioHost.respondOnce(IO.CDK_TOOLKIT_I7010, true);
 *   await toolkit.destroy({ ... });
 *   recorder.matchSnapshot();
 * });
 * ```
 *
 * Run `yarn jest -u` to create/update the snapshot files. Snapshots are
 * written next to the test file under
 * `__io_snapshots__/<test-file>/<test-name>.ndjson`.
 */
export class IoHostRecorder {
  /**
   * Get (or lazily create) the recorder for the given IoHost by registering a
   * message observer on it. Repeated calls for the same host return the same
   * recorder (the observer is registered exactly once) and reset its per-test
   * observation buffer, so each test starts fresh.
   */
  public static create(host: ObservableIoHost, options: IoHostRecorderOptions = {}): IoHostRecorder {
    const existing = IoHostRecorder.cache.get(host);
    if (existing) {
      // Same recorder across the (singleton) host; clear the per-test
      // observation buffer so each test starts fresh.
      existing.resetObservations();
      return existing;
    }
    if (typeof host?.observeMessages !== 'function') {
      throw new Error('IoHostRecorder requires an ObservableIoHost (e.g. CliIoHost); the given host does not implement observeMessages()');
    }
    const recorder = new IoHostRecorder(options);
    // Capture the effective disposition of every message the host handles
    // (notifications and requests). The observer is never removed: the host is
    // a singleton, so the recorder is shared and the observer is installed once.
    host.observeMessages((observation) => {
      recorder.observations.push(observation);
    });
    IoHostRecorder.cache.set(host, recorder);
    return recorder;
  }

  /**
   * One recorder per host instance. Because the CLI IoHost is a singleton,
   * this effectively yields a single shared recorder, and ensures we only
   * install the observer once regardless of how many times `create` is called.
   */
  private static readonly cache = new WeakMap<object, IoHostRecorder>();

  private readonly scrubbers: Scrubber[];
  private readonly level: IoMessageLevel;
  private readonly excludeDropped: boolean;

  // The ordered stream of messages the host handled this test, collected via
  // its `observeMessages` hook. Cleared between tests by `resetObservations`.
  private readonly observations: IoMessageObservation[] = [];

  private constructor(options: IoHostRecorderOptions) {
    this.scrubbers = [...defaultScrubbers(), ...(options.scrubbers ?? [])];
    this.level = options.level ?? 'trace';
    this.excludeDropped = options.excludeDropped ?? true;
  }

  private resetObservations(): void {
    this.observations.length = 0;
  }

  /**
   * Build the ordered list of recorded entries from the observed message
   * stream. Observations are already in the order the host handled them, so no
   * separate ordering is needed.
   */
  public entries(): RecordedIoEntry[] {
    const entries: RecordedIoEntry[] = [];
    let seq = 0;
    for (const { type, emitted, effective, dropped } of this.observations) {
      // Optionally omit suppressed messages so the snapshot reflects only what
      // the user sees.
      if (dropped && this.excludeDropped) {
        continue;
      }
      // The single decision point for which levels are included; uses the
      // effective level so listener level-overrides are respected.
      if (!isMessageRelevantForLevel({ level: effective.level }, this.level)) {
        continue;
      }

      const entry: RecordedIoEntry = {
        seq: seq++,
        type,
        action: emitted.action,
        level: effective.level,
        code: emitted.code ?? null,
        message: this.normalize(String(effective.message ?? '')),
        // A suppressed notification is recorded and flagged so the snapshot
        // protects listener-based suppression (see the class doc). Requests are
        // never dropped.
        ...(dropped ? { dropped: true } : {}),
        // For requests, also record the resolved response (scrubbed).
        ... ((type === 'request' && 'defaultResponse' in effective) ? { response: this.scrubValue(effective.defaultResponse) } : {}),
      };
      entries.push(entry);
    }
    return entries;
  }

  /**
   * Render the recorded entries as NDJSON (one JSON object per line).
   */
  public toNdjson(): string {
    const lines = this.entries().map((e) => JSON.stringify(e));
    return lines.length > 0 ? lines.join('\n') + '\n' : '';
  }

  /**
   * Compare the recorded NDJSON against the on-disk snapshot, creating or
   * updating it when running with `-u` (or in `--ci` mode, failing if missing).
   */
  public matchSnapshot(name?: string): void {
    const actual = this.toNdjson();
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
