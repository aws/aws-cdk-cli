import type { SynthRunResult } from '../core/synth-runner';

/**
 * Trigger a one-shot synth of the user's CDK app. Only shown when
 * auto-synth is disabled (saves handle synth when it is enabled).
 */
export const COMMAND_SYNTH_NOW = 'cdk.explorer.synthNow';
/** Enable auto-synth-on-save. Replaces "Synth now" in the header lens. */
export const COMMAND_ENABLE_AUTO_SYNTH = 'cdk.explorer.enableAutoSynth';
/** Disable auto-synth-on-save. Restores the "Synth now" header lens. */
export const COMMAND_DISABLE_AUTO_SYNTH = 'cdk.explorer.disableAutoSynth';

/** All commands this LSP advertises via `executeCommandProvider`. */
export const SUPPORTED_COMMANDS = [COMMAND_SYNTH_NOW, COMMAND_ENABLE_AUTO_SYNTH, COMMAND_DISABLE_AUTO_SYNTH] as const;

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
  /** Called with the new desired state when the user toggles auto-synth. */
  readonly toggleAutoSynth: (enabled: boolean) => void;
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
  switch (command) {
    case COMMAND_ENABLE_AUTO_SYNTH:
      options.toggleAutoSynth(true);
      return;

    case COMMAND_DISABLE_AUTO_SYNTH:
      options.toggleAutoSynth(false);
      return;

    case COMMAND_SYNTH_NOW:
      if (!options.synthAvailable) {
        options.notify.info(SYNTH_UNAVAILABLE_MESSAGE);
        return;
      }
      {
        const result = await options.notify.withProgress(PROGRESS_MESSAGE, () => options.synth());
        handleSynthResult(result, options.notify);
      }
      return;

    default:
      return;
  }
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
