import { cappedExponentialBackoff } from '../../../lib/api/aws-auth/private';

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
