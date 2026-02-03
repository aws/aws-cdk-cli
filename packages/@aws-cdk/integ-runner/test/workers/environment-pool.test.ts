import * as fc from 'fast-check';
import type { TestEnvironment } from '../../lib/workers/environment-pool';
import { EnvironmentPool } from '../../lib/workers/environment-pool';

describe('EnvironmentPool', () => {
  describe('constructor', () => {
    test('initializes with provided environments', () => {
      // GIVEN
      const environments: TestEnvironment[] = [
        { region: 'us-east-1' },
        { region: 'us-west-2', profile: 'dev' },
      ];

      // WHEN
      const pool = new EnvironmentPool(environments);

      // THEN
      expect(pool.isAvailable({ region: 'us-east-1' })).toBe(true);
      expect(pool.isAvailable({ region: 'us-west-2', profile: 'dev' })).toBe(true);
      expect(pool.getAvailableEnvironments()).toHaveLength(2);
    });

    test('initializes with empty environments list', () => {
      // WHEN
      const pool = new EnvironmentPool([]);

      // THEN
      expect(pool.getAvailableEnvironments()).toHaveLength(0);
      expect(pool.getRemovedEnvironments()).toHaveLength(0);
    });

    test('handles duplicate environments', () => {
      // GIVEN - same environment specified twice
      const environments: TestEnvironment[] = [
        { region: 'us-east-1' },
        { region: 'us-east-1' },
      ];

      // WHEN
      const pool = new EnvironmentPool(environments);

      // THEN - should deduplicate
      expect(pool.getAvailableEnvironments()).toHaveLength(1);
    });
  });

  describe('removeEnvironment', () => {
    test('removes environment correctly', () => {
      // GIVEN
      const pool = new EnvironmentPool([
        { region: 'us-east-1' },
        { region: 'us-west-2' },
      ]);

      // WHEN
      pool.removeEnvironment({ region: 'us-east-1' }, 'Not bootstrapped');

      // THEN
      expect(pool.isAvailable({ region: 'us-east-1' })).toBe(false);
      expect(pool.isAvailable({ region: 'us-west-2' })).toBe(true);
      expect(pool.getAvailableEnvironments()).toHaveLength(1);
    });

    test('records removal reason and account', () => {
      // GIVEN
      const pool = new EnvironmentPool([{ region: 'us-east-1' }]);

      // WHEN
      pool.removeEnvironment({ region: 'us-east-1' }, 'Bootstrap stack not found', '123456789012');

      // THEN
      const removed = pool.getRemovedEnvironments();
      expect(removed).toHaveLength(1);
      expect(removed[0].region).toBe('us-east-1');
      expect(removed[0].reason).toBe('Bootstrap stack not found');
      expect(removed[0].account).toBe('123456789012');
      expect(removed[0].removedAt).toBeInstanceOf(Date);
    });

    test('does not add to removed list if environment was not available', () => {
      // GIVEN
      const pool = new EnvironmentPool([{ region: 'us-east-1' }]);

      // WHEN - try to remove an environment that doesn't exist
      pool.removeEnvironment({ region: 'eu-west-1' }, 'Not bootstrapped');

      // THEN
      expect(pool.getRemovedEnvironments()).toHaveLength(0);
    });

    test('removing same environment twice has no effect', () => {
      // GIVEN
      const pool = new EnvironmentPool([{ region: 'us-east-1' }]);
      pool.removeEnvironment({ region: 'us-east-1' }, 'First removal');

      // WHEN
      pool.removeEnvironment({ region: 'us-east-1' }, 'Second removal');

      // THEN - should still only have one removal record
      expect(pool.getRemovedEnvironments()).toHaveLength(1);
      expect(pool.getRemovedEnvironments()[0].reason).toBe('First removal');
    });
  });

  describe('isAvailable', () => {
    test('returns true for available environment', () => {
      // GIVEN
      const pool = new EnvironmentPool([{ region: 'us-east-1' }]);

      // THEN
      expect(pool.isAvailable({ region: 'us-east-1' })).toBe(true);
    });

    test('returns false for removed environment', () => {
      // GIVEN
      const pool = new EnvironmentPool([{ region: 'us-east-1' }]);
      pool.removeEnvironment({ region: 'us-east-1' }, 'Not bootstrapped');

      // THEN
      expect(pool.isAvailable({ region: 'us-east-1' })).toBe(false);
    });

    test('returns false for environment never added', () => {
      // GIVEN
      const pool = new EnvironmentPool([{ region: 'us-east-1' }]);

      // THEN
      expect(pool.isAvailable({ region: 'eu-west-1' })).toBe(false);
    });

    test('treats undefined profile as default profile', () => {
      // GIVEN
      const pool = new EnvironmentPool([{ region: 'us-east-1' }]);

      // THEN - both should refer to the same environment
      expect(pool.isAvailable({ region: 'us-east-1' })).toBe(true);
      expect(pool.isAvailable({ region: 'us-east-1', profile: undefined })).toBe(true);
    });
  });

  describe('profile+region combinations', () => {
    test('tracks profile+region combinations independently', () => {
      // GIVEN
      const pool = new EnvironmentPool([
        { region: 'us-east-1', profile: 'profile1' },
        { region: 'us-east-1', profile: 'profile2' },
        { region: 'us-east-1' }, // default profile
      ]);

      // THEN - all three should be available
      expect(pool.isAvailable({ region: 'us-east-1', profile: 'profile1' })).toBe(true);
      expect(pool.isAvailable({ region: 'us-east-1', profile: 'profile2' })).toBe(true);
      expect(pool.isAvailable({ region: 'us-east-1' })).toBe(true);
      expect(pool.getAvailableEnvironments()).toHaveLength(3);
    });

    test('removing one profile does not affect other profiles in same region', () => {
      // GIVEN
      const pool = new EnvironmentPool([
        { region: 'us-east-1', profile: 'profile1' },
        { region: 'us-east-1', profile: 'profile2' },
      ]);

      // WHEN
      pool.removeEnvironment({ region: 'us-east-1', profile: 'profile1' }, 'Not bootstrapped');

      // THEN
      expect(pool.isAvailable({ region: 'us-east-1', profile: 'profile1' })).toBe(false);
      expect(pool.isAvailable({ region: 'us-east-1', profile: 'profile2' })).toBe(true);
    });

    test('same region with different profiles are distinct', () => {
      // GIVEN
      const pool = new EnvironmentPool([
        { region: 'us-east-1', profile: 'dev' },
        { region: 'us-east-1', profile: 'prod' },
      ]);

      // WHEN - remove dev profile
      pool.removeEnvironment({ region: 'us-east-1', profile: 'dev' }, 'Not bootstrapped');

      // THEN
      expect(pool.getAvailableEnvironments()).toEqual([
        { region: 'us-east-1', profile: 'prod' },
      ]);
      expect(pool.getRemovedEnvironments()).toHaveLength(1);
      expect(pool.getRemovedEnvironments()[0].profile).toBe('dev');
    });
  });

  describe('getAvailableEnvironments', () => {
    test('returns all available environments', () => {
      // GIVEN
      const pool = new EnvironmentPool([
        { region: 'us-east-1' },
        { region: 'us-west-2', profile: 'dev' },
      ]);

      // THEN
      const available = pool.getAvailableEnvironments();
      expect(available).toHaveLength(2);
      expect(available).toContainEqual({ region: 'us-east-1', profile: undefined });
      expect(available).toContainEqual({ region: 'us-west-2', profile: 'dev' });
    });

    test('excludes removed environments', () => {
      // GIVEN
      const pool = new EnvironmentPool([
        { region: 'us-east-1' },
        { region: 'us-west-2' },
      ]);
      pool.removeEnvironment({ region: 'us-east-1' }, 'Not bootstrapped');

      // THEN
      const available = pool.getAvailableEnvironments();
      expect(available).toHaveLength(1);
      expect(available[0].region).toBe('us-west-2');
    });
  });

  describe('getRemovedEnvironments', () => {
    test('returns empty array when no environments removed', () => {
      // GIVEN
      const pool = new EnvironmentPool([{ region: 'us-east-1' }]);

      // THEN
      expect(pool.getRemovedEnvironments()).toEqual([]);
    });

    test('returns all removed environments with info', () => {
      // GIVEN
      const pool = new EnvironmentPool([
        { region: 'us-east-1' },
        { region: 'us-west-2', profile: 'dev' },
      ]);

      // WHEN
      pool.removeEnvironment({ region: 'us-east-1' }, 'Reason 1', '111111111111');
      pool.removeEnvironment({ region: 'us-west-2', profile: 'dev' }, 'Reason 2', '222222222222');

      // THEN
      const removed = pool.getRemovedEnvironments();
      expect(removed).toHaveLength(2);

      const env1 = removed.find(e => e.region === 'us-east-1');
      expect(env1).toBeDefined();
      expect(env1!.reason).toBe('Reason 1');
      expect(env1!.account).toBe('111111111111');

      const env2 = removed.find(e => e.region === 'us-west-2');
      expect(env2).toBeDefined();
      expect(env2!.profile).toBe('dev');
      expect(env2!.reason).toBe('Reason 2');
      expect(env2!.account).toBe('222222222222');
    });
  });
});

/**
 * Property-Based Tests for EnvironmentPool
 *
 * These tests verify universal properties that should hold across all valid inputs.
 */
describe('EnvironmentPool Property-Based Tests', () => {
  // Arbitrary generators for test data
  const regionArb = fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', '-', '1', '2', '3'), { minLength: 1, maxLength: 15 });
  const profileArb = fc.option(fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', '-', '1', '2', '3'), { minLength: 1, maxLength: 10 }), { nil: undefined });
  const accountArb = fc.option(fc.stringMatching(/^[0-9]{12}$/), { nil: undefined });
  const reasonArb = fc.string({ minLength: 1, maxLength: 100 });

  const testEnvironmentArb: fc.Arbitrary<TestEnvironment> = fc.record({
    region: regionArb,
    profile: profileArb,
  });

  /**
   * Property 5: Environment Removal Tracking
   *
   * *For any* environment marked as removed via `EnvironmentPool.removeEnvironment()`,
   * subsequent calls to `isAvailable()` with the same profile+region combination should
   * return `false`, and `getRemovedEnvironments()` should include that environment.
   *
   * **Validates: Requirements 3.1**
   */
  describe('Property 5: Environment Removal Tracking', () => {
    test('removed environments are no longer available and appear in getRemovedEnvironments', () => {
      fc.assert(
        fc.property(
          fc.array(testEnvironmentArb, { minLength: 1, maxLength: 20 }),
          reasonArb,
          accountArb,
          (environments, reason, account) => {
            // GIVEN - a pool with some environments
            const pool = new EnvironmentPool(environments);

            // Pick a random environment to remove (first one for simplicity)
            const envToRemove = environments[0];

            // Verify it's initially available
            const wasAvailable = pool.isAvailable(envToRemove);

            // WHEN - remove the environment
            pool.removeEnvironment(envToRemove, reason, account);

            // THEN
            // 1. isAvailable should return false for the removed environment
            expect(pool.isAvailable(envToRemove)).toBe(false);

            // 2. If it was available before, it should now be in getRemovedEnvironments
            if (wasAvailable) {
              const removed = pool.getRemovedEnvironments();
              const found = removed.find(
                r => r.region === envToRemove.region && r.profile === envToRemove.profile,
              );
              expect(found).toBeDefined();
              expect(found!.reason).toBe(reason);
              if (account !== undefined) {
                expect(found!.account).toBe(account);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    test('multiple removals maintain consistency', () => {
      fc.assert(
        fc.property(
          fc.array(testEnvironmentArb, { minLength: 2, maxLength: 10 }),
          fc.array(fc.nat({ max: 9 }), { minLength: 1, maxLength: 5 }),
          reasonArb,
          (environments, indicesToRemove, reason) => {
            // GIVEN
            const pool = new EnvironmentPool(environments);
            const removedSet = new Set<string>();

            // WHEN - remove multiple environments
            for (const idx of indicesToRemove) {
              const envIdx = idx % environments.length;
              const env = environments[envIdx];
              const key = `${env.profile ?? 'default'}:${env.region}`;

              if (pool.isAvailable(env)) {
                removedSet.add(key);
              }
              pool.removeEnvironment(env, reason);
            }

            // THEN - all removed environments should not be available
            for (const env of environments) {
              const key = `${env.profile ?? 'default'}:${env.region}`;
              if (removedSet.has(key)) {
                expect(pool.isAvailable(env)).toBe(false);
              }
            }

            // And getRemovedEnvironments should contain all removed ones
            const removedEnvs = pool.getRemovedEnvironments();
            for (const removed of removedEnvs) {
              const key = `${removed.profile ?? 'default'}:${removed.region}`;
              expect(removedSet.has(key)).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 6: Profile-Region Independence
   *
   * *For any* two distinct profile+region combinations (e.g., profile1/us-east-1 and
   * profile2/us-east-1), removing one environment should not affect the `isAvailable()`
   * result for the other.
   *
   * **Validates: Requirements 3.3**
   */
  describe('Property 6: Profile-Region Independence', () => {
    test('removing one profile+region does not affect other combinations', () => {
      fc.assert(
        fc.property(
          testEnvironmentArb,
          testEnvironmentArb,
          reasonArb,
          (env1, env2, reason) => {
            // Skip if environments are the same
            const key1 = `${env1.profile ?? 'default'}:${env1.region}`;
            const key2 = `${env2.profile ?? 'default'}:${env2.region}`;
            fc.pre(key1 !== key2);

            // GIVEN - a pool with both environments
            const pool = new EnvironmentPool([env1, env2]);

            // Both should be available initially
            expect(pool.isAvailable(env1)).toBe(true);
            expect(pool.isAvailable(env2)).toBe(true);

            // WHEN - remove env1
            pool.removeEnvironment(env1, reason);

            // THEN - env2 should still be available
            expect(pool.isAvailable(env1)).toBe(false);
            expect(pool.isAvailable(env2)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    test('same region with different profiles are independent', () => {
      fc.assert(
        fc.property(
          regionArb,
          // Use alphanumeric profiles without colons to match realistic AWS profile names
          fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', '-', '_', '1', '2', '3'), { minLength: 1, maxLength: 10 }),
          fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', '-', '_', '1', '2', '3'), { minLength: 1, maxLength: 10 }),
          reasonArb,
          (region, profile1, profile2, reason) => {
            // Ensure profiles are different
            fc.pre(profile1 !== profile2);

            const env1: TestEnvironment = { region, profile: profile1 };
            const env2: TestEnvironment = { region, profile: profile2 };

            // GIVEN - same region, different profiles
            const pool = new EnvironmentPool([env1, env2]);

            // WHEN - remove one
            pool.removeEnvironment(env1, reason);

            // THEN - the other should still be available
            expect(pool.isAvailable(env1)).toBe(false);
            expect(pool.isAvailable(env2)).toBe(true);

            // And available environments should only contain env2
            const available = pool.getAvailableEnvironments();
            expect(available).toHaveLength(1);
            expect(available[0].region).toBe(region);
            expect(available[0].profile).toBe(profile2);
          },
        ),
        { numRuns: 100 },
      );
    });

    test('default profile is independent from named profiles', () => {
      fc.assert(
        fc.property(
          regionArb,
          // Use alphanumeric profiles without colons to match realistic AWS profile names
          fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', '-', '_', '1', '2', '3'), { minLength: 1, maxLength: 10 }),
          reasonArb,
          (region, namedProfile, reason) => {
            const envDefault: TestEnvironment = { region };
            const envNamed: TestEnvironment = { region, profile: namedProfile };

            // GIVEN - same region, one default profile, one named profile
            const pool = new EnvironmentPool([envDefault, envNamed]);

            // Both should be available
            expect(pool.isAvailable(envDefault)).toBe(true);
            expect(pool.isAvailable(envNamed)).toBe(true);

            // WHEN - remove the default profile environment
            pool.removeEnvironment(envDefault, reason);

            // THEN - named profile should still be available
            expect(pool.isAvailable(envDefault)).toBe(false);
            expect(pool.isAvailable(envNamed)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
