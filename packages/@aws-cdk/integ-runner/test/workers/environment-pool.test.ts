import type { TestEnvironment } from '../../lib/workers/environment-pool';
import { EnvironmentPool } from '../../lib/workers/environment-pool';

describe('EnvironmentPool', () => {
  test('initializes with the provided environments', () => {
    const pool = new EnvironmentPool([
      { region: 'us-east-1' },
      { region: 'us-west-2', profile: 'dev' },
    ]);

    expect(pool.isAvailable({ region: 'us-east-1' })).toBe(true);
    expect(pool.isAvailable({ region: 'us-west-2', profile: 'dev' })).toBe(true);
    expect(pool.hasAvailable()).toBe(true);
  });

  test('empty pool has no available environments', () => {
    const pool = new EnvironmentPool([]);

    expect(pool.hasAvailable()).toBe(false);
    expect(pool.summary().removed).toEqual([]);
  });

  test('deduplicates identical environments', () => {
    const pool = new EnvironmentPool([
      { region: 'us-east-1' },
      { region: 'us-east-1' },
    ]);

    expect(pool.remove({ region: 'us-east-1' }, 'not bootstrapped')).toBe(true);
    expect(pool.hasAvailable()).toBe(false);
  });

  test('remove marks environment unavailable and records the reason', () => {
    const pool = new EnvironmentPool([
      { region: 'us-east-1' },
      { region: 'us-west-2' },
    ]);

    const removed = pool.remove({ region: 'us-east-1', account: '123456789012' }, 'not bootstrapped');

    expect(removed).toBe(true);
    expect(pool.isAvailable({ region: 'us-east-1' })).toBe(false);
    expect(pool.isAvailable({ region: 'us-west-2' })).toBe(true);
    expect(pool.summary().removed).toEqual([{
      region: 'us-east-1',
      account: '123456789012',
      reason: 'not bootstrapped',
    }]);
  });

  test('removing an unknown environment has no effect', () => {
    const pool = new EnvironmentPool([{ region: 'us-east-1' }]);

    expect(pool.remove({ region: 'eu-west-1' }, 'not bootstrapped')).toBe(false);
    expect(pool.summary().removed).toEqual([]);
  });

  test('removing the same environment twice keeps the first removal record', () => {
    const pool = new EnvironmentPool([{ region: 'us-east-1' }]);

    expect(pool.remove({ region: 'us-east-1' }, 'first reason')).toBe(true);
    expect(pool.remove({ region: 'us-east-1' }, 'second reason')).toBe(false);

    expect(pool.summary().removed).toHaveLength(1);
    expect(pool.summary().removed[0].reason).toBe('first reason');
  });

  test('unknown environments are not available', () => {
    const pool = new EnvironmentPool([{ region: 'us-east-1' }]);

    expect(pool.isAvailable({ region: 'eu-west-1' })).toBe(false);
  });

  test('the account is not part of the environment identity', () => {
    const pool = new EnvironmentPool([{ region: 'us-east-1' }]);

    // account is usually only discovered when a test fails, the pool was
    // initialized without it
    expect(pool.isAvailable({ region: 'us-east-1', account: '123456789012' })).toBe(true);
    expect(pool.remove({ region: 'us-east-1', account: '123456789012' }, 'not bootstrapped')).toBe(true);
    expect(pool.isAvailable({ region: 'us-east-1' })).toBe(false);
  });

  describe('profile+region combinations', () => {
    const profile1: TestEnvironment = { region: 'us-east-1', profile: 'profile1' };
    const profile2: TestEnvironment = { region: 'us-east-1', profile: 'profile2' };
    const defaultProfile: TestEnvironment = { region: 'us-east-1' };

    test('same region with different profiles are distinct environments', () => {
      const pool = new EnvironmentPool([profile1, profile2, defaultProfile]);

      pool.remove(profile1, 'not bootstrapped');

      expect(pool.isAvailable(profile1)).toBe(false);
      expect(pool.isAvailable(profile2)).toBe(true);
      expect(pool.isAvailable(defaultProfile)).toBe(true);
    });

    test('default profile is distinct from a named profile', () => {
      const pool = new EnvironmentPool([defaultProfile, profile1]);

      pool.remove(defaultProfile, 'not bootstrapped');

      expect(pool.isAvailable(defaultProfile)).toBe(false);
      expect(pool.isAvailable(profile1)).toBe(true);
    });

    test('a profile literally named "default" is distinct from the default profile', () => {
      const namedDefault: TestEnvironment = { region: 'us-east-1', profile: 'default' };
      const pool = new EnvironmentPool([defaultProfile, namedDefault]);

      pool.remove(namedDefault, 'not bootstrapped');

      expect(pool.isAvailable(namedDefault)).toBe(false);
      expect(pool.isAvailable(defaultProfile)).toBe(true);
    });
  });
});
