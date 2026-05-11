import { cappedExponentialBackoff } from '../../../lib/api/aws-auth/private';

describe(cappedExponentialBackoff, () => {
  test('returns exponentially growing delays while below the cap', () => {
    const backoff = cappedExponentialBackoff(1000, 15_000);

    expect(backoff(1)).toBe(2000);
    expect(backoff(2)).toBe(4000);
    expect(backoff(3)).toBe(8000);
  });

  test('clamps delays to the provided maximum', () => {
    const backoff = cappedExponentialBackoff(1000, 15_000);

    // Uncapped would be 16_000, 32_000, 1024 * 1000, 2048 * 1000 etc.
    expect(backoff(4)).toBe(15_000);
    expect(backoff(5)).toBe(15_000);
    expect(backoff(10)).toBe(15_000);
    expect(backoff(20)).toBe(15_000);
  });

  test('bounds total retry time for the CloudFormation client configuration', () => {
    // This mirrors the actual production config: 7 retries, 1s base, 15s cap.
    // Without the cap the total retry time was ~34 minutes, which manifests as
    // a hang to CLI users when CloudFormation returns InternalFailure.
    const backoff = cappedExponentialBackoff(1000, 15_000);

    let total = 0;
    for (let attempt = 1; attempt <= 6; attempt++) {
      total += backoff(attempt);
    }

    // 2 + 4 + 8 + 15 + 15 + 15 = 59 seconds
    expect(total).toBe(59_000);
    expect(total).toBeLessThan(120_000);
  });

  test('can produce delays smaller than the base when base is small', () => {
    const backoff = cappedExponentialBackoff(100, 10_000);

    expect(backoff(0)).toBe(100);
    expect(backoff(1)).toBe(200);
  });
});
