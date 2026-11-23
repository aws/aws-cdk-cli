import { AdaptiveRetryStrategy, ConfiguredRetryStrategy } from '@smithy/util-retry';
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
 * The retry strategies the CLI can hand to an SDK client
 */
export type SdkRetryStrategy = ConfiguredRetryStrategy | AdaptiveRetryStrategy;

/**
 * Build the retry strategy for an SDK client
 *
 * Passing an explicit `retryStrategy` to an SDK client makes the SDK ignore the standard
 * `AWS_MAX_ATTEMPTS` and `AWS_RETRY_MODE` environment variables, so we resolve them here
 * and fall back to `defaultMaxAttempts` when the user has not set one. The backoff schedule
 * is not user-configurable: there is no standard variable for it, and we tune it per client.
 *
 * `legacy` is accepted for compatibility with other AWS tools and treated as `standard`.
 *
 * @param defaultMaxAttempts - total number of attempts, including the initial call, if `AWS_MAX_ATTEMPTS` is not set
 * @param backoffMs - delay in milliseconds before the given attempt
 */
export function sdkRetryStrategy(defaultMaxAttempts: number, backoffMs: (attempt: number) => number): SdkRetryStrategy {
  const maxAttempts = maxAttemptsFromEnv() ?? defaultMaxAttempts;
  const retryMode = process.env[AWS_RETRY_MODE_ENV]?.trim() || 'standard';

  switch (retryMode.toLowerCase()) {
    case 'standard':
    case 'legacy':
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
      throw new ToolkitError('InvalidRetryConfiguration', `${AWS_RETRY_MODE_ENV} must be one of 'standard', 'adaptive' or 'legacy', got '${retryMode}'`);
  }
}

function maxAttemptsFromEnv(): number | undefined {
  const raw = process.env[AWS_MAX_ATTEMPTS_ENV]?.trim();
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ToolkitError('InvalidRetryConfiguration', `${AWS_MAX_ATTEMPTS_ENV} must be a positive integer, got '${raw}'`);
  }
  return value;
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
