import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader';
import { AdaptiveRetryStrategy, ConfiguredRetryStrategy } from '@smithy/util-retry';
import type { SdkRetrySettings } from './base-credentials';
import { ToolkitError } from '../../toolkit/toolkit-error';

/**
 * Standard AWS environment variable that sets the total number of attempts (initial call plus retries)
 */
export const AWS_MAX_ATTEMPTS_ENV = 'AWS_MAX_ATTEMPTS';

/**
 * Standard AWS environment variable that selects the retry mode
 */
export const AWS_RETRY_MODE_ENV = 'AWS_RETRY_MODE';

/**
 * Shared config file key equivalent to `AWS_MAX_ATTEMPTS`
 */
const MAX_ATTEMPTS_CONFIG_KEY = 'max_attempts';

/**
 * Shared config file key equivalent to `AWS_RETRY_MODE`
 */
const RETRY_MODE_CONFIG_KEY = 'retry_mode';

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
 * @param settings - the user's retry settings, see `retrySettingsFromEnv` and `retrySettingsFromEnvAndProfile`
 */
export function sdkRetryStrategy(
  defaultMaxAttempts: number,
  backoffMs: (attempt: number) => number,
  settings: SdkRetrySettings,
): SdkRetryStrategy {
  const maxAttempts = settings.maxAttempts ?? defaultMaxAttempts;

  if (settings.mode === 'adaptive') {
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
  }

  // Standard mode with our own backoff schedule
  return new ConfiguredRetryStrategy(maxAttempts, backoffMs);
}

/**
 * Read the user's retry settings from the `AWS_MAX_ATTEMPTS` and `AWS_RETRY_MODE` environment variables
 */
export function retrySettingsFromEnv(): SdkRetrySettings {
  return {
    maxAttempts: parseMaxAttempts(process.env[AWS_MAX_ATTEMPTS_ENV], AWS_MAX_ATTEMPTS_ENV),
    mode: parseRetryMode(process.env[AWS_RETRY_MODE_ENV], AWS_RETRY_MODE_ENV),
  };
}

/**
 * Read the user's retry settings the way the AWS CLI does
 *
 * Each setting is taken from its environment variable first, then from the given profile in the
 * shared config files. Like the SDK, a value in `~/.aws/config` takes precedence over one in
 * `~/.aws/credentials`, and there is no fallback to the `default` profile.
 */
export async function retrySettingsFromEnvAndProfile(profile: string): Promise<SdkRetrySettings> {
  const fromEnv = retrySettingsFromEnv();
  const sharedFiles = await loadSharedConfigFiles({ ignoreCache: true });
  const fromProfile = (key: string): string | undefined =>
    sharedFiles.configFile?.[profile]?.[key] ?? sharedFiles.credentialsFile?.[profile]?.[key];

  return {
    maxAttempts: fromEnv.maxAttempts
      ?? parseMaxAttempts(fromProfile(MAX_ATTEMPTS_CONFIG_KEY), `'${MAX_ATTEMPTS_CONFIG_KEY}' in profile '${profile}'`),
    mode: fromEnv.mode
      ?? parseRetryMode(fromProfile(RETRY_MODE_CONFIG_KEY), `'${RETRY_MODE_CONFIG_KEY}' in profile '${profile}'`),
  };
}

/**
 * @param source - where the value came from, for the error message
 */
function parseMaxAttempts(raw: string | undefined, source: string): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1) {
    throw new ToolkitError('InvalidRetryConfiguration', `${source} must be a positive integer, got '${trimmed}'`);
  }
  return value;
}

/**
 * `legacy` is accepted for compatibility with other AWS tools and treated as `standard`.
 *
 * @param source - where the value came from, for the error message
 */
function parseRetryMode(raw: string | undefined, source: string): SdkRetrySettings['mode'] {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  switch (trimmed.toLowerCase()) {
    case 'standard':
    case 'legacy':
      return 'standard';
    case 'adaptive':
      return 'adaptive';
    default:
      throw new ToolkitError('InvalidRetryConfiguration', `${source} must be one of 'standard', 'adaptive' or 'legacy', got '${trimmed}'`);
  }
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
