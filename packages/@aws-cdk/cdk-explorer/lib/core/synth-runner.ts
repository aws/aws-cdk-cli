import { ToolkitError, type Toolkit } from '@aws-cdk/toolkit-lib';
import { readCdkConfig } from './cdk-config';

/* eslint-disable import/no-relative-packages -- toolkit-lib watch internals are not re-exported from its package index */
import { WATCH_EXCLUDE_DEFAULTS } from '../../../toolkit-lib/lib/actions/watch/private/helpers';

/**
 * Files whose changes are not treated as CDK source edits by the source
 * watchers (the LSP's auto-synth-on-save and the web server), so both apply an
 * identical policy. Excluding cdk.out is essential: it prevents a
 * synth -> cdk.out write -> re-synth loop. node_modules and dotfiles cut noise.
 */
export const SOURCE_WATCH_EXCLUDES = [
  ...WATCH_EXCLUDE_DEFAULTS,
  '**/cdk.out/**',
  '**/node_modules/**',
  '.*',
  '**/.*',
  '**/.*/**',
];

/**
 * Hold synth()'s read lock this long before releasing it. While we hold a
 * reader, the next synth cannot take the write lock, so a watcher refresh that
 * fires in this window shares the read lock rather than being starved under
 * continuous synths. The refresh also retries its own acquire on contention
 * (see refreshFromAssembly), so this delay is an anti-starvation hint, not a
 * correctness requirement.
 */
const READER_HANDOFF_DELAY_MS = 100;

/**
 * The outcome of a single synth attempt.
 *
 * `success` means the assembly was written to disk (the watcher will see it).
 * `app-failure` means the user's CDK app threw, did not compile, or needs uncached context lookups.
 * `lock-conflict` means another process holds `<projectDir>/cdk.out` (a `cdk
 * synth` running in a terminal, a `cdk watch` loop, or our own previous synth
 * not yet released). Callers should not surface this as a hard error.
 * `unavailable` means `cdk.json` is missing or has no `app` key, so there is
 * nothing to synth. Read fresh on every call, so adding an `app` later is
 * picked up without restarting the LSP.
 * `error` is reserved for anything we did not classify, including failures
 * during dispose.
 */
export type SynthRunResult =
  | { status: 'success' }
  | { status: 'app-failure'; message: string; details?: string }
  | { status: 'lock-conflict' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export interface SynthRunnerOptions {
  /** A configured Toolkit instance (its IoHost decides where messages go). */
  readonly toolkit: Toolkit;
  /** Directory containing the user's `cdk.json`; also the synth working dir. */
  readonly projectDir: string;
}

/**
 * Run a one-shot synth of the user's CDK app. Writes `<projectDir>/cdk.out`
 * via `Toolkit.synth(fromCdkApp(...))`, then immediately disposes the cached
 * assembly so the read lock is released before the next call. Holding the
 * cached assembly between calls would cause the next acquireWrite to throw
 * `ConcurrentReadLock` against ourselves.
 *
 * The `app` command is read from `cdk.json` on every call, not cached, so an
 * edited command or a newly added `app` takes effect on the next synth.
 */
export async function runSynth(options: SynthRunnerOptions): Promise<SynthRunResult> {
  const app = readCdkConfig(options.projectDir).app;
  if (app === undefined) return { status: 'unavailable' };

  let cached;
  try {
    const cx = await options.toolkit.fromCdkApp(app, {
      workingDirectory: options.projectDir,
      lookups: false,
      // Make jsii forward host-language (Python/Java) source frames; TS resolves via source maps.
      env: { JSII_HOST_STACK_TRACES: '1' },
    });
    cached = await options.toolkit.synth(cx);
  } catch (err) {
    return classify(err);
  }

  // Brief hold so the cdk.out watcher can take its own read lock before the
  // next writer comes in (see READER_HANDOFF_DELAY_MS), then release.
  await new Promise<void>((resolve) => setTimeout(resolve, READER_HANDOFF_DELAY_MS));

  try {
    await cached.dispose();
  } catch (err) {
    // Releases the read lock synth() left on the assembly. Failure is rare (an
    // fs error deleting the lock file); report it as `error` so the next synth
    // does not silently self-conflict on the stale reader.
    return { status: 'error', message: (err as Error).message };
  }

  return { status: 'success' };
}

function classify(err: unknown): SynthRunResult {
  if (ToolkitError.isLockError(err)) {
    return { status: 'lock-conflict' };
  }
  if (ToolkitError.isContextLookupsDisabledError(err)) {
    return {
      status: 'app-failure',
      message: 'This app needs context lookups that are not in cdk.context.json. '
        + 'Run `cdk synth` in a terminal (with AWS credentials) to populate it, then retry.',
    };
  }
  if (ToolkitError.isAssemblyError(err)) {
    // details = captured subprocess stderr (file:line:col), used for diagnostics.
    return { status: 'app-failure', message: err.message, details: (err.cause as Error | undefined)?.message };
  }
  return { status: 'error', message: (err as Error).message };
}
