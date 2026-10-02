import { StalenessTracker } from '../../lib/web/staleness';

describe('StalenessTracker', () => {
  test('reports nothing stale before any assembly is loaded', () => {
    const t = new StalenessTracker();
    expect(t.isStale(Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  test('a file modified after the reference is stale; at or before is not', () => {
    const t = new StalenessTracker();
    t.onAssemblyRefreshed(1_000);
    expect(t.isStale(1_001)).toBe(true);
    expect(t.isStale(1_000)).toBe(false); // equal is not newer
    expect(t.isStale(999)).toBe(false);
  });

  test('prefers observed synth-start over the manifest mtime (option 2)', () => {
    const t = new StalenessTracker();
    t.noteSynthActivity(500); // synth started at 500
    t.onAssemblyRefreshed(2_000); // ...and finished (manifest) at 2000
    // A file edited at 800 (during the synth) is newer than synth-start -> stale,
    // even though it predates synth-finish.
    expect(t.isStale(800)).toBe(true);
  });

  test('keeps the earliest synth-activity timestamp within a generation', () => {
    const t = new StalenessTracker();
    t.noteSynthActivity(500);
    t.noteSynthActivity(1_500); // later activity does not move the reference
    t.onAssemblyRefreshed(3_000);
    expect(t.isStale(600)).toBe(true); // newer than 500
  });

  test('falls back to the manifest mtime when no synth activity was observed', () => {
    const t = new StalenessTracker();
    t.onAssemblyRefreshed(2_000);
    expect(t.isStale(1_500)).toBe(false);
    expect(t.isStale(2_500)).toBe(true);
  });

  test('clears synth activity after a refresh so the next generation re-measures', () => {
    const t = new StalenessTracker();
    t.noteSynthActivity(500);
    t.onAssemblyRefreshed(2_000); // reference = 500
    // Next generation: no new activity observed -> falls back to its manifest mtime.
    t.onAssemblyRefreshed(4_000); // reference = 4000
    expect(t.isStale(3_000)).toBe(false);
    expect(t.isStale(4_500)).toBe(true);
  });
});
