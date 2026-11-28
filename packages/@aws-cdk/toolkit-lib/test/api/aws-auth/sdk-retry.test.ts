import * as os from 'os';
import * as path from 'path';
import { AdaptiveRetryStrategy, ConfiguredRetryStrategy } from '@smithy/util-retry';
import * as fs from 'fs-extra';
import {
  cappedExponentialBackoff,
  retrySettings,
  retrySettingsFromConfig,
  retrySettingsFromEnv,
  sdkRetryStrategy,
} from '../../../lib/api/aws-auth/private';

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

const ENV_VARS = ['AWS_MAX_ATTEMPTS', 'AWS_RETRY_MODE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE'];
const originalEnv = Object.fromEntries(ENV_VARS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  delete process.env.AWS_MAX_ATTEMPTS;
  delete process.env.AWS_RETRY_MODE;
  // make sure we don't read the developer's own config files
  process.env.AWS_CONFIG_FILE = '/dev/null';
  process.env.AWS_SHARED_CREDENTIALS_FILE = '/dev/null';
});

afterEach(() => {
  // `clearMocks` does not restore a spy's implementation, and two tests below rely
  // on real randomness.
  jest.restoreAllMocks();

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
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

  beforeEach(() => {
    backoffMs = jest.fn().mockReturnValue(0);
  });

  /**
   * Ask the strategy for a retry after one failed attempt
   */
  async function retryOnce(strategy: ConfiguredRetryStrategy | AdaptiveRetryStrategy) {
    const token = await strategy.acquireInitialRetryToken('scope');
    return strategy.refreshRetryTokenForRetry(token as any, { errorType: 'TRANSIENT' } as any);
  }

  test('uses the defaults when the user has not configured retries', async () => {
    const strategy = sdkRetryStrategy(7, backoffMs, {});

    expect(strategy).toBeInstanceOf(ConfiguredRetryStrategy);
    await expect(strategy.maxAttemptsProvider()).resolves.toBe(7);
    await retryOnce(strategy);
    expect(backoffMs).toHaveBeenCalledWith(1);
  });

  test('maxAttempts overrides the default number of attempts and keeps our backoff', async () => {
    const strategy = sdkRetryStrategy(7, backoffMs, { maxAttempts: 2 });

    await expect(strategy.maxAttemptsProvider()).resolves.toBe(2);
    await retryOnce(strategy);
    expect(backoffMs).toHaveBeenCalled();
  });

  test.each([1, 0, -1])('maxAttempts of %p disables retries', async (maxAttempts) => {
    const strategy = sdkRetryStrategy(7, backoffMs, { maxAttempts });

    await expect(retryOnce(strategy)).rejects.toThrow(/No retry token available/);
  });

  test('standard mode uses the standard strategy', () => {
    expect(sdkRetryStrategy(7, backoffMs, { mode: 'standard' })).toBeInstanceOf(ConfiguredRetryStrategy);
  });

  test('adaptive mode uses the adaptive strategy with our attempts and backoff', async () => {
    const strategy = sdkRetryStrategy(5, backoffMs, { mode: 'adaptive' });

    expect(strategy).toBeInstanceOf(AdaptiveRetryStrategy);
    await expect(strategy.maxAttemptsProvider()).resolves.toBe(5);
    await retryOnce(strategy);
    // Same attempt numbering as ConfiguredRetryStrategy
    expect(backoffMs).toHaveBeenCalledWith(1);
  });

  test('adaptive mode honours maxAttempts', async () => {
    const strategy = sdkRetryStrategy(7, backoffMs, { mode: 'adaptive', maxAttempts: 1 });

    await expect(strategy.maxAttemptsProvider()).resolves.toBe(1);
    await expect(retryOnce(strategy)).rejects.toThrow(/No retry token available/);
  });
});

describe(retrySettingsFromEnv, () => {
  test('returns nothing when no environment variables are set', () => {
    expect(retrySettingsFromEnv()).toEqual({ maxAttempts: undefined, mode: undefined });
  });

  test('treats empty environment variables as unset', () => {
    process.env.AWS_MAX_ATTEMPTS = '';
    process.env.AWS_RETRY_MODE = '';

    expect(retrySettingsFromEnv()).toEqual({ maxAttempts: undefined, mode: undefined });
  });

  test('reads AWS_MAX_ATTEMPTS and AWS_RETRY_MODE', () => {
    process.env.AWS_MAX_ATTEMPTS = '2';
    process.env.AWS_RETRY_MODE = 'adaptive';

    expect(retrySettingsFromEnv()).toEqual({ maxAttempts: 2, mode: 'adaptive' });
  });

  test.each([
    ['1.5', 1],
    ['3abc', 3],
    ['0', 0],
    ['-1', -1],
  ])('parses AWS_MAX_ATTEMPTS=%p like the SDK, as %p', (value, expected) => {
    process.env.AWS_MAX_ATTEMPTS = value;

    expect(retrySettingsFromEnv().maxAttempts).toBe(expected);
  });

  test.each(['abc', ' '])('rejects AWS_MAX_ATTEMPTS that is not a number: %p', (value) => {
    process.env.AWS_MAX_ATTEMPTS = value;

    expect(() => retrySettingsFromEnv()).toThrow(`AWS_MAX_ATTEMPTS must be a number, got '${value}'`);
  });

  test.each(['standard', 'legacy', 'ADAPTIVE', 'aggressive'])('AWS_RETRY_MODE=%s means standard mode', (mode) => {
    process.env.AWS_RETRY_MODE = mode;

    expect(retrySettingsFromEnv().mode).toBe('standard');
  });
});

describe('reading shared config files', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-retry.test'));
  });

  afterEach(() => {
    fs.removeSync(workdir);
  });

  function writeConfigFile(contents: string) {
    const configPath = path.join(workdir, 'config');
    fs.writeFileSync(configPath, contents);
    process.env.AWS_CONFIG_FILE = configPath;
  }

  function writeCredentialsFile(contents: string) {
    const credentialsPath = path.join(workdir, 'credentials');
    fs.writeFileSync(credentialsPath, contents);
    process.env.AWS_SHARED_CREDENTIALS_FILE = credentialsPath;
  }

  describe(retrySettingsFromConfig, () => {
    test('reads settings from the profile in the config file', async () => {
      writeConfigFile('[profile ci]\nmax_attempts = 4\nretry_mode = adaptive\n');

      await expect(retrySettingsFromConfig('ci')).resolves.toEqual({ maxAttempts: 4, mode: 'adaptive' });
    });

    test('reads settings from the default profile', async () => {
      writeConfigFile('[default]\nmax_attempts = 4\n');

      await expect(retrySettingsFromConfig('default')).resolves.toEqual({ maxAttempts: 4, mode: undefined });
    });

    test('ignores settings in the credentials file', async () => {
      writeCredentialsFile('[ci]\nmax_attempts = 4\nretry_mode = adaptive\n');

      await expect(retrySettingsFromConfig('ci')).resolves.toEqual({ maxAttempts: undefined, mode: undefined });
    });

    test('does not fall back to the default profile', async () => {
      writeConfigFile('[default]\nmax_attempts = 4\nretry_mode = adaptive\n[profile ci]\nregion = us-east-1\n');

      await expect(retrySettingsFromConfig('ci')).resolves.toEqual({ maxAttempts: undefined, mode: undefined });
    });

    test('rejects a max_attempts that is not a number and names the profile', async () => {
      writeConfigFile('[profile ci]\nmax_attempts = lots\n');

      await expect(retrySettingsFromConfig('ci')).rejects.toThrow("'max_attempts' in profile 'ci' must be a number, got 'lots'");
    });
  });

  describe(retrySettings, () => {
    test('environment variables take precedence over the profile, per setting', async () => {
      writeConfigFile('[profile ci]\nmax_attempts = 4\nretry_mode = adaptive\n');
      process.env.AWS_MAX_ATTEMPTS = '2';

      await expect(retrySettings('ci')).resolves.toEqual({ maxAttempts: 2, mode: 'adaptive' });
    });

    test('an unknown AWS_RETRY_MODE still takes precedence over the profile', async () => {
      // Like the SDK: the environment variable is set, so the profile is not consulted
      writeConfigFile('[profile ci]\nretry_mode = adaptive\n');
      process.env.AWS_RETRY_MODE = 'aggressive';

      await expect(retrySettings('ci')).resolves.toEqual({ maxAttempts: undefined, mode: 'standard' });
    });
  });
});
