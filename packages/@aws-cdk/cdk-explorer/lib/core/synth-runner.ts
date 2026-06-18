import { ToolkitError, type Toolkit } from '@aws-cdk/toolkit-lib';

/**
 * The outcome of a single synth attempt.
 *
 * `success` means the assembly was written to disk (the watcher will see it).
 * `app-failure` means the user's CDK app threw, did not compile, or needs uncached context lookups.
 * `lock-conflict` means another process holds `<projectDir>/cdk.out` (a `cdk
 * synth` running in a terminal, a `cdk watch` loop, or our own previous synth
 * not yet released). Callers should not surface this as a hard error.
 * `error` is reserved for anything we did not classify, including failures
 * during dispose.
 */
export type SynthRunResult =
  | { status: 'success' }
  | { status: 'app-failure'; message: string; details?: string }
  | { status: 'lock-conflict' }
  | { status: 'error'; message: string };

export interface SynthRunnerOptions {
  /** A configured Toolkit instance (its IoHost decides where messages go). */
  readonly toolkit: Toolkit;
  /** Directory containing the user's `cdk.json`; also the synth working dir. */
  readonly projectDir: string;
  /** The `app` command from `cdk.json` (e.g. `npx ts-node bin/app.ts`). */
  readonly app: string;
}

/**
 * Run a one-shot synth of the user's CDK app. Writes `<projectDir>/cdk.out`
 * via `Toolkit.synth(fromCdkApp(...))`, then immediately disposes the cached
 * assembly so the read lock is released before the next call. Holding the
 * cached assembly between calls would cause the next acquireWrite to throw
 * `ConcurrentReadLock` against ourselves.
 */
export async function runSynth(options: SynthRunnerOptions): Promise<SynthRunResult> {
  let cached;
  try {
    const cx = await options.toolkit.fromCdkApp(options.app, {
      workingDirectory: options.projectDir,
      lookups: false,
    });
    cached = await options.toolkit.synth(cx);
  } catch (err) {
    return classify(err);
  }

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
