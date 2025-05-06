import { durationToSeconds } from '../../../lib/cli/util/duration';

describe('durationToSeconds', () => {
  test.each([
    ['10s', 10],
    ['15m', 900],
    ['2h', 3600 * 2],
    ['1d', 3600 * 24],
  ])('%p converts to %p seconds', (pattern, seconds) => {
    expect(durationToSeconds(pattern)).toEqual(seconds);
  });

  test('throws on invalid pattern', () => {
    expect(() => durationToSeconds('10e')).toThrow('Invalid duration pattern');
  });
});
