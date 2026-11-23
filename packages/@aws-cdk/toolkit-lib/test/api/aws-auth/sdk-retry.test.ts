import { AdaptiveRetryStrategy, ConfiguredRetryStrategy } from '@smithy/util-retry';
import { cappedExponentialBackoff, sdkRetryStrategy } from '../../../lib/api/aws-auth/private';

/**
 * The top of the jitter window is the delay the schedule asks for, so mocking
 * `Math.random()` to 1 lets the schedule be asserted without jitter arithmetic.
 */
function mockTopOfJitterWindow() {
  jest.spyOn(Math, 'random').mockReturnValue(1);
}

/**
 * The delay for `attempt` before jitter is applied
 */
function scheduled(attempt: number, baseMs = 1000, capMs = 15_000) {
  return Math.min(baseMs * (2 ** attempt), capMs);
}

afterEach(() => {
  // `clearMocks` does not restore a spy's implementation, and two tests below rely
  // on real randomness.
  jest.restoreAllMocks();
});

describe(cappedExponentialBackoff, () => {
  test('returns exponentially growing delays while below the cap', () => {
    mockTopOfJitterWindow();
    const backoff = cappedExponentialBackoff(1000, 15_000);

    expect(backoff(1)).toBe(2000);
    expect(backoff(2)).toBe(4000);
    expect(backoff(3)).toBe(8000);
  });

  test('clamps delays to the provided maximum', () => {
    mockTopOfJitterWindow();
    const backoff = cappedExponentialBackoff(1000, 15_000);

    // Uncapped would be 16_000, 32_000, 1024 * 1000, 2048 * 1000 etc.
    expect(backoff(4)).toBe(15_000);
    expect(backoff(5)).toBe(15_000);
    expect(backoff(10)).toBe(15_000);
    expect(backoff(20)).toBe(15_000);
  });

  test('never waits less than half the scheduled delay', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const backoff = cappedExponentialBackoff(1000, 15_000);

    expect(backoff(1)).toBe(1000);
    expect(backoff(4)).toBe(7500);
    expect(backoff(20)).toBe(7500);
  });

  test('stays within the jitter window for every attempt', () => {
    const backoff = cappedExponentialBackoff(1000, 15_000);

    for (let attempt = 1; attempt <= 10; attempt++) {
      for (let i = 0; i < 100; i++) {
        const delay = backoff(attempt);
        expect(delay).toBeGreaterThanOrEqual(Math.floor(scheduled(attempt) / 2));
        expect(delay).toBeLessThan(scheduled(attempt));
      }
    }
  });

  test('disperses callers that retry at the same moment', () => {
    // Requests throttled together retry together, so identical inputs must not
    // produce identical delays; otherwise the herd stays synchronized.
    const backoff = cappedExponentialBackoff(1000, 15_000);

    const delays = new Set(Array.from({ length: 50 }, () => backoff(4)));

    expect(delays.size).toBeGreaterThan(1);
  });

  test('bounds total retry time for the CloudFormation client configuration', () => {
    // This mirrors the actual production config: 7 retries, 1s base, 15s cap.
    // Without the cap the total retry time was ~34 minutes, which manifests as
    // a hang to CLI users when CloudFormation returns InternalFailure.
    mockTopOfJitterWindow();
    const backoff = cappedExponentialBackoff(1000, 15_000);

    let total = 0;
    for (let attempt = 1; attempt <= 6; attempt++) {
      total += backoff(attempt);
    }

    // 2 + 4 + 8 + 15 + 15 + 15 = 59 seconds
    expect(total).toBe(59_000);
    expect(total).toBeLessThan(120_000);
  });

  test('scales the schedule with the configured base', () => {
    mockTopOfJitterWindow();
    const backoff = cappedExponentialBackoff(100, 10_000);

    expect(backoff(1)).toBe(200);
    expect(backoff(2)).toBe(400);
  });
});

describe(sdkRetryStrategy, () => {
  /**
   * A zero-delay backoff, so retries in these tests don't actually sleep
   */
  let backoffMs: jest.Mock;
  const originalEnv = { AWS_MAX_ATTEMPTS: process.env.AWS_MAX_ATTEMPTS, AWS_RETRY_MODE: process.env.AWS_RETRY_MODE };

  beforeEach(() => {
    backoffMs = jest.fn().mockReturnValue(0);
    delete process.env.AWS_MAX_ATTEMPTS;
    delete process.env.AWS_RETRY_MODE;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  /**
   * Ask the strategy for a retry after one failed attempt
   */
  async function retryOnce(strategy: ConfiguredRetryStrategy | AdaptiveRetryStrategy) {
    const token = await strategy.acquireInitialRetryToken('scope');
    return strategy.refreshRetryTokenForRetry(token as any, { errorType: 'TRANSIENT' } as any);
  }

  test('uses the defaults when no environment variables are set', async () => {
    const strategy = sdkRetryStrategy(7, backoffMs);

    expect(strategy).toBeInstanceOf(ConfiguredRetryStrategy);
    await expect(strategy.maxAttemptsProvider()).resolves.toBe(7);
    await retryOnce(strategy);
    expect(backoffMs).toHaveBeenCalledWith(1);
  });

  test('treats empty environment variables as unset', async () => {
    process.env.AWS_MAX_ATTEMPTS = '';
    process.env.AWS_RETRY_MODE = ' ';
    const strategy = sdkRetryStrategy(7, backoffMs);

    expect(strategy).toBeInstanceOf(ConfiguredRetryStrategy);
    await expect(strategy.maxAttemptsProvider()).resolves.toBe(7);
  });

  test('AWS_MAX_ATTEMPTS overrides the default number of attempts and keeps our backoff', async () => {
    process.env.AWS_MAX_ATTEMPTS = '2';
    const strategy = sdkRetryStrategy(7, backoffMs);

    await expect(strategy.maxAttemptsProvider()).resolves.toBe(2);
    await retryOnce(strategy);
    expect(backoffMs).toHaveBeenCalled();
  });

  test('AWS_MAX_ATTEMPTS=1 disables retries', async () => {
    process.env.AWS_MAX_ATTEMPTS = '1';
    const strategy = sdkRetryStrategy(7, backoffMs);

    await expect(retryOnce(strategy)).rejects.toThrow(/No retry token available/);
  });

  test.each(['0', '-1', '1.5', 'abc'])('rejects invalid AWS_MAX_ATTEMPTS %p', (value) => {
    process.env.AWS_MAX_ATTEMPTS = value;
    expect(() => sdkRetryStrategy(7, backoffMs)).toThrow(/AWS_MAX_ATTEMPTS must be a positive integer/);
  });

  test.each(['standard', 'legacy', 'STANDARD'])('AWS_RETRY_MODE=%s uses the standard strategy', (mode) => {
    process.env.AWS_RETRY_MODE = mode;
    expect(sdkRetryStrategy(7, backoffMs)).toBeInstanceOf(ConfiguredRetryStrategy);
  });

  test('AWS_RETRY_MODE=adaptive uses the adaptive strategy with our attempts and backoff', async () => {
    process.env.AWS_RETRY_MODE = 'adaptive';
    const strategy = sdkRetryStrategy(5, backoffMs);

    expect(strategy).toBeInstanceOf(AdaptiveRetryStrategy);
    await expect(strategy.maxAttemptsProvider()).resolves.toBe(5);
    await retryOnce(strategy);
    // Same attempt numbering as ConfiguredRetryStrategy
    expect(backoffMs).toHaveBeenCalledWith(1);
  });

  test('AWS_RETRY_MODE=adaptive honours AWS_MAX_ATTEMPTS', async () => {
    process.env.AWS_RETRY_MODE = 'adaptive';
    process.env.AWS_MAX_ATTEMPTS = '1';
    const strategy = sdkRetryStrategy(7, backoffMs);

    await expect(strategy.maxAttemptsProvider()).resolves.toBe(1);
    await expect(retryOnce(strategy)).rejects.toThrow(/No retry token available/);
  });

  test('rejects an unknown AWS_RETRY_MODE', () => {
    process.env.AWS_RETRY_MODE = 'aggressive';
    expect(() => sdkRetryStrategy(7, backoffMs)).toThrow(/AWS_RETRY_MODE must be one of/);
  });
});
