import type { SynthRunResult } from '../core/synth-runner';

/**
 * Runs the user's CDK app (`bin/app.ts`) via `Toolkit.synth()`, writes new
 * CloudFormation templates to `cdk.out`, then the watcher picks up the change
 * and republishes diagnostics automatically. Use when source code has changed.
 * Takes seconds — it re-executes the app.
 */
export const COMMAND_SYNTH_NOW = 'cdk.explorer.synthNow';

/** All commands this LSP advertises via `executeCommandProvider`. */
export const SUPPORTED_COMMANDS = [COMMAND_SYNTH_NOW] as const;

/**
 * UI sinks the dispatcher uses to communicate with the user.
 * Implementations bridge to `connection.console` in the LSP layer.
 */
export interface NotifySink {
  /** Write a non-error informational message to the Output panel. */
  info(message: string): void;
  /** Write an error message to the Output panel. */
  error(message: string): void;
  /**
   * Run a long operation with a visible progress indicator. The implementation
   * is responsible for ending the indicator regardless of success or failure.
   */
  withProgress<T>(message: string, fn: () => Promise<T>): Promise<T>;
}

export interface CommandHandlerOptions {
  /** Invokes a single synth. Resolves with the typed outcome; never rejects. */
  readonly synth: () => Promise<SynthRunResult>;
  /**
   * Whether `synth` can be invoked. False when `cdk.json` is missing or has
   * no `app` key; the synth command is then unavailable to the user.
   */
  readonly synthAvailable: boolean;
  /** UI sinks for messages and progress. */
  readonly notify: NotifySink;
}

const SYNTH_UNAVAILABLE_MESSAGE = "CDK synth unavailable: 'cdk.json' missing or has no 'app' key.";
const LOCK_CONFLICT_MESSAGE = 'Another synth is in progress. Results will refresh shortly.';
const PROGRESS_MESSAGE = 'Synthesizing CDK app...';

/**
 * Handle a `workspace/executeCommand` request. The synth command runs under a
 * progress indicator and reports outcomes through the notify sinks. Unknown
 * commands are silently ignored.
 */
export async function executeCommand(
  command: string,
  _args: unknown[],
  options: CommandHandlerOptions,
): Promise<void> {
  if (command !== COMMAND_SYNTH_NOW) return;

  if (!options.synthAvailable) {
    options.notify.info(SYNTH_UNAVAILABLE_MESSAGE);
    return;
  }
  const result = await options.notify.withProgress(PROGRESS_MESSAGE, () => options.synth());
  handleSynthResult(result, options.notify);
}

function handleSynthResult(result: SynthRunResult, notify: NotifySink): void {
  switch (result.status) {
    case 'success':
      // Silent. The watcher refreshes the editor when `cdk.out` changes.
      return;
    case 'app-failure':
      notify.error(`CDK synth failed: ${result.message}`);
      return;
    case 'lock-conflict':
      notify.info(LOCK_CONFLICT_MESSAGE);
      return;
    case 'error':
      notify.error(`CDK synth failed unexpectedly: ${result.message}`);
      return;
  }
}
