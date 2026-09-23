import { ActiveAssetCache } from '../../../lib/api/garbage-collection/stack-refresh';

describe(ActiveAssetCache, () => {
  test('contains returns false when no stacks are remembered', () => {
    const cache = new ActiveAssetCache();
    expect(cache.contains('some-asset-hash')).toBe(false);
  });

  test('contains finds an asset referenced anywhere within a remembered template', () => {
    const cache = new ActiveAssetCache();
    cache.rememberStack('{"Resources":{"Bucket":{"Properties":{"Key":"prefix-abc123def-suffix.zip"}}}}');
    expect(cache.contains('abc123def')).toBe(true);
    expect(cache.contains('not-present')).toBe(false);
  });

  test('contains searches across all remembered stacks, not just the first', () => {
    const cache = new ActiveAssetCache();
    cache.rememberStack('{"Resources":{"A":"nothing-relevant-here"}}');
    cache.rememberStack('{"Resources":{"B":"has-the-hash-xyz789-in-it"}}');
    cache.rememberStack('{"Resources":{"C":"also-irrelevant"}}');
    expect(cache.contains('xyz789')).toBe(true);
  });

  test('an asset hash cannot false-positive-match across a template boundary', () => {
    const cache = new ActiveAssetCache();
    // Concatenating these naively (without a separator) would form "foobar" at the boundary
    cache.rememberStack('...foo');
    cache.rememberStack('bar...');
    expect(cache.contains('foobar')).toBe(false);
  });

  test('remembering a new stack after a contains() call is still picked up (no stale cache)', () => {
    const cache = new ActiveAssetCache();
    cache.rememberStack('template-one');
    expect(cache.contains('late-hash')).toBe(false);

    cache.rememberStack('template-two-with-late-hash');
    expect(cache.contains('late-hash')).toBe(true);
  });

  describe('containsAny', () => {
    test('returns exactly the subset of candidates that are present, across many stacks', () => {
      const cache = new ActiveAssetCache();
      cache.rememberStack('irrelevant-stack-one');
      cache.rememberStack('stack-with-hashA-and-hashB');
      cache.rememberStack('irrelevant-stack-two');
      cache.rememberStack('another-stack-with-hashC');

      const result = cache.containsAny(['hashA', 'hashB', 'hashC', 'hashD-not-present']);
      expect(result).toEqual(new Set(['hashA', 'hashB', 'hashC']));
    });

    test('returns an empty set for an empty candidate list', () => {
      const cache = new ActiveAssetCache();
      cache.rememberStack('anything');
      expect(cache.containsAny([])).toEqual(new Set());
    });

    test('handles duplicate candidates', () => {
      const cache = new ActiveAssetCache();
      cache.rememberStack('has-dupe-hash');
      expect(cache.containsAny(['dupe-hash', 'dupe-hash', 'missing'])).toEqual(new Set(['dupe-hash']));
    });

    test('one pattern being a substring of another does not cause a miss', () => {
      const cache = new ActiveAssetCache();
      cache.rememberStack('template-contains-abcdef-only');
      // 'abc' is a prefix of 'abcdef' -- both must independently register as found/not-found correctly
      const result = cache.containsAny(['abcdef', 'abc', 'xyz']);
      expect(result).toEqual(new Set(['abcdef', 'abc']));
    });

    test('does not false-positive-match across a template boundary', () => {
      const cache = new ActiveAssetCache();
      cache.rememberStack('...foo');
      cache.rememberStack('bar...');
      expect(cache.containsAny(['foobar'])).toEqual(new Set());
    });

    test('agrees with the naive per-candidate contains() on a randomized workload (no false negatives)', () => {
      function randHash(rng: () => number) {
        return Array.from({ length: 12 }, () => Math.floor(rng() * 16).toString(16)).join('');
      }
      // Simple deterministic PRNG so failures are reproducible. Math.imul keeps
      // the multiply within a 32-bit-safe integer (no bitwise operators, no
      // precision loss from JS doubles on the full product).
      let seed = 42;
      const rng = () => {
        seed = Math.imul(seed, 1103515245) + 12345;
        seed = seed % 0x7fffffff;
        if (seed < 0) {
          seed += 0x7fffffff;
        }
        return seed / 0x7fffffff;
      };

      const cache = new ActiveAssetCache();
      const embeddedHashes: string[] = [];
      for (let i = 0; i < 20; i++) {
        const h = randHash(rng);
        embeddedHashes.push(h);
        cache.rememberStack(`{"Resources":{"R${i}":{"Key":"prefix-${h}-suffix"}}}`);
      }

      const candidates: string[] = [];
      for (let i = 0; i < 100; i++) {
        candidates.push(rng() < 0.4 ? embeddedHashes[Math.floor(rng() * embeddedHashes.length)] : randHash(rng));
      }

      const expected = new Set(candidates.filter((c) => cache.contains(c)));
      const actual = cache.containsAny(candidates);
      expect(actual).toEqual(expected);
    });
  });
});
