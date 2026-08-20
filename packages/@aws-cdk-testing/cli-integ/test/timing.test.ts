import { MemoryStream } from '../lib/corking';
import { formatDuration, timed, timedSync } from '../lib/timing';

describe('formatDuration', () => {
  test.each([
    [0, '0ms'],
    [1, '1ms'],
    [386, '386ms'],
    [999, '999ms'],
  ])('renders %dms as milliseconds: %s', (millis, expected) => {
    expect(formatDuration(millis)).toEqual(expected);
  });

  test.each([
    [1_000, '1.0s'],
    [9_386, '9.4s'],
    [29_961, '30.0s'],
    [59_949, '59.9s'],
  ])('renders %dms as seconds with one decimal: %s', (millis, expected) => {
    expect(formatDuration(millis)).toEqual(expected);
  });

  test.each([
    [60_000, '1m0s'],
    [137_000, '2m17s'],
    [3_600_000, '60m0s'],
  ])('renders %dms as minutes and seconds: %s', (millis, expected) => {
    expect(formatDuration(millis)).toEqual(expected);
  });

  test('rolls up to the next minute instead of rendering 60 seconds', () => {
    // 119_700ms rounds to 120s, which must not come out as '1m60s'
    expect(formatDuration(119_700)).toEqual('2m0s');
  });
});

// Matches '⏱️  57ms some description'
const TIMING_LINE = /⏱️\s+\d+(\.\d+)?(ms|s)\s/;

describe('timed', () => {
  test('announces the operation and reports its duration', async () => {
    const output = new MemoryStream();

    await timed('do the thing', output, async () => {
    });

    expect(output.toString()).toMatch(/💻 do the thing/);
    expect(output.toString()).toMatch(TIMING_LINE);
  });

  test('returns the value produced by the block', async () => {
    expect(await timed('compute', undefined, async () => 42)).toEqual(42);
  });

  test('reports the duration even when the block throws', async () => {
    const output = new MemoryStream();

    await expect(timed('failing thing', output, async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(output.toString()).toMatch(TIMING_LINE);
  });

  test('tolerates a missing output stream', async () => {
    await expect(timed('no output', undefined, async () => {
    })).resolves.toBeUndefined();
  });
});

describe('timedSync', () => {
  test('announces the operation and reports its duration', () => {
    const output = new MemoryStream();

    timedSync('do the sync thing', output, () => {
    });

    expect(output.toString()).toMatch(/💻 do the sync thing/);
    expect(output.toString()).toMatch(TIMING_LINE);
  });

  test('returns the value produced by the block', () => {
    expect(timedSync('compute', undefined, () => 42)).toEqual(42);
  });

  test('reports the duration even when the block throws', () => {
    const output = new MemoryStream();

    expect(() => timedSync('failing thing', output, () => {
      throw new Error('boom');
    })).toThrow('boom');

    expect(output.toString()).toMatch(TIMING_LINE);
  });
});
