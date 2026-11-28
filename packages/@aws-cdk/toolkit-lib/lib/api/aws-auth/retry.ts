import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader';
import { AdaptiveRetryStrategy, ConfiguredRetryStrategy } from '@smithy/util-retry';
import type { SdkRetrySettings } from './base-credentials';
import { ToolkitError } from '../../toolkit/toolkit-error';

/**
 * The retry strategies the CLI can hand to an SDK client
 */
export type SdkRetryStrategy = ConfiguredRetryStrategy | AdaptiveRetryStrategy;

/**
 * Build the retry strategy for an SDK client
 *
 * Passing an explicit `retryStrategy` to an SDK client makes the SDK ignore the user's retry
 * configuration, so we apply the user's settings here and fall back to `defaultMaxAttempts`
 * when they have not set one. The backoff schedule is not user-configurable: there is no
 * standard setting for it, and we tune it per client.
 *
 * @param defaultMaxAttempts - total number of attempts, including the initial call, if the user has not set one
 * @param backoffMs - delay in milliseconds before the given attempt
 * @param settings - the user's retry settings, see `retrySettingsFromEnv` and `retrySettings`
 */
export function sdkRetryStrategy(
  defaultMaxAttempts: number,
  backoffMs: (attempt: number) => number,
  settings: SdkRetrySettings,
): SdkRetryStrategy {
  if (Number.isNaN(settings.maxAttempts)) {
    throw new ToolkitError('InvalidRetryConfiguration', 'invalid value provided for max attempts, must be a whole number');
  }
  const maxAttempts = settings.maxAttempts ?? defaultMaxAttempts;

  switch (settings.mode) {
    case undefined:
    case 'standard':
      // Standard mode with our own backoff schedule
      return new ConfiguredRetryStrategy(maxAttempts, backoffMs);
    case 'adaptive':
      return new AdaptiveRetryStrategy(maxAttempts, {
        maxAttempts,
        backoff: {
          // The SDK passes the number of completed attempts; our schedule is keyed on the next one,
          // which matches how `ConfiguredRetryStrategy` calls its backoff function.
          computeNextBackoffDelay: (completedAttempts: number) => backoffMs(completedAttempts + 1),
          // The delay base is baked into our backoff function
          setDelayBase: () => undefined,
        },
      });
    default:
      // Stricter than the JavaScript SDK, which silently uses standard mode for anything that isn't
      // exactly 'adaptive', typos included:
      // https://github.com/smithy-lang/smithy-typescript/blob/d6725176da29286396c921bbe52d3bbd6b93a46b/packages/core/src/submodules/retry/middleware-retry/configurations.ts#L102-L114
      // We reject unknown modes like the AWS CLI v2 does, which also rejects 'legacy'.
      throw new ToolkitError(
        'InvalidRetryConfiguration',
        `invalid value provided for retry mode: '${settings.mode}', must be one of 'standard' or 'adaptive'`,
      );
  }
}

/**
 * Read the user's retry settings from the `AWS_MAX_ATTEMPTS` and `AWS_RETRY_MODE` environment variables
 */
export function retrySettingsFromEnv(): SdkRetrySettings {
  const maxAttempts = process.env.AWS_MAX_ATTEMPTS;
  return {
    maxAttempts: maxAttempts ? parseInt(maxAttempts) : undefined,
    mode: process.env.AWS_RETRY_MODE || undefined,
  };
}

/**
 * Read the user's retry settings the way the AWS CLI does
 *
 * Each setting is taken from its environment variable first, then from the given profile
 * in the shared config files.
 */
export async function retrySettings(profile: string): Promise<SdkRetrySettings> {
  const fromEnv = retrySettingsFromEnv();
  const fromConfig = await retrySettingsFromConfig(profile);
  return {
    maxAttempts: fromEnv.maxAttempts ?? fromConfig.maxAttempts,
    mode: fromEnv.mode ?? fromConfig.mode,
  };
}

/**
 * Read the user's retry settings from the given profile in the shared config file
 *
 * Only `~/.aws/config` is read: the credentials file may only hold credentials, and the
 * retry settings are documented for the config file only. There is no fallback to the
 * `default` profile.
 *
 * @see https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
 */
export async function retrySettingsFromConfig(profile: string): Promise<SdkRetrySettings> {
  const { configFile } = await loadSharedConfigFiles({ ignoreCache: true });
  const fromProfile = (key: string): string | undefined => configFile?.[profile]?.[key];
  const maxAttempts = fromProfile('max_attempts');

  return {
    maxAttempts: maxAttempts ? parseInt(maxAttempts) : undefined,
    mode: fromProfile('retry_mode') || undefined,
  };
}

/**
 * Build a jittered exponential-backoff delay function whose result is capped at a maximum.
 *
 * An uncapped exponential backoff (`base * 2^attempt`) grows without bound as the
 * number of retries increases. For the retry counts we use on the CloudFormation
 * client in particular, that means the SDK can spend *tens of minutes* silently
 * sleeping between retries when the service returns a retryable error such as
 * `InternalFailure`. To the user that looks like the CLI has hung. Capping each
 * individual delay at ~15s bounds the total retry time to a few minutes at worst,
 * while still giving the SDK plenty of opportunity to ride out transient server
 * problems or throttling.
 *
 * The delay is jittered because `ConfiguredRetryStrategy` replaces the SDK's own
 * jittered backoff with whatever function it is handed. Without jitter, requests
 * that were throttled at the same moment retry at the same moments, and a herd of
 * pollers stays a herd instead of dispersing over the retry window. We use equal
 * jitter - a random point in `[floor(delay/2), delay - 1]` - rather than the SDK's
 * full jitter, so that the worst case stays under the capped delay above and the
 * wait before a retry never collapses to nearly zero.
 *
 * @param baseMs - base delay in milliseconds (used in `baseMs * 2^attempt`)
 * @param capMs - maximum delay in milliseconds; any computed delay larger than this is clamped
 */
export function cappedExponentialBackoff(baseMs: number, capMs: number): (attempt: number) => number {
  return (attempt: number) => {
    const delay = Math.min(baseMs * (2 ** attempt), capMs);
    return Math.floor(delay / 2 + Math.random() * (delay / 2));
  };
}
