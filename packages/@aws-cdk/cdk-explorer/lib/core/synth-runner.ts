import { ToolkitError, type Toolkit } from '@aws-cdk/toolkit-lib';
import { fromCdkAppDirectory, retryOnLock } from './from-cdk-app-directory';

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
 * - `success` means the assembly was written to disk (the watcher will see it).
 * - `app-failure` means the user's CDK app threw, did not compile, or needs uncached context lookups.
 * - `unavailable` means `cdk.json` is missing or has no `app` key, so there is
 * nothing to synth. Read fresh on every call, so adding an `app` later is
 * picked up without restarting the LSP.
 * - `error` is reserved for anything we did not classify, including failures
 * during dispose.
 */
export type SynthRunResult =
  | { status: 'success' }
  | { status: 'app-failure'; message: string; details?: string }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export interface SynthRunnerOptions {
  /** A configured Toolkit instance (its IoHost decides where messages go). */
  readonly toolkit: Toolkit;
  /** Directory containing the user's `cdk.json`; also the synth working dir. */
  readonly projectDir: string;

  readonly abort: AbortSignal;
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
  let asm;
  try {
    const cx = await fromCdkAppDirectory(options.toolkit, options.projectDir);
    if (!cx) {
      return { status: 'unavailable' };
    }

    asm = await retryOnLock(options.abort, () => options.toolkit.synth(cx, { abort: options.abort }));
  } catch (err) {
    return classify(err);
  }

  // Brief hold so the cdk.out watcher can take its own read lock before the
  // next writer comes in (see READER_HANDOFF_DELAY_MS), then release.
  await new Promise<void>((resolve) => setTimeout(resolve, READER_HANDOFF_DELAY_MS));

  try {
    await asm.dispose();
  } catch (err) {
    // Releases the read lock synth() left on the assembly. Failure is rare (an
    // fs error deleting the lock file); report it as `error` so the next synth
    // does not silently self-conflict on the stale reader.
    return { status: 'error', message: (err as Error).message };
  }

  return { status: 'success' };
}

function classify(err: unknown): SynthRunResult {
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
