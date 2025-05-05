import { padLeft, padRight, formatTime } from '../../lib/util/string-manipulation';

describe('string-manipulation', () => {
  describe('padLeft', () => {
    test('adds padding to the left of a string', () => {
      expect(padLeft(5, 'abc')).toBe('  abc');
    });

    test('returns the string unchanged if it is already at the target length', () => {
      expect(padLeft(3, 'abc')).toBe('abc');
    });

    test('returns the string unchanged if it exceeds the target length', () => {
      expect(padLeft(2, 'abc')).toBe('abc');
    });

    test('uses the specified padding character', () => {
      expect(padLeft(5, 'abc', '*')).toBe('**abc');
    });

    test('handles empty strings', () => {
      expect(padLeft(3, '')).toBe('   ');
    });
  });

  describe('padRight', () => {
    test('adds padding to the right of a string', () => {
      expect(padRight(5, 'abc')).toBe('abc  ');
    });

    test('returns the string unchanged if it is already at the target length', () => {
      expect(padRight(3, 'abc')).toBe('abc');
    });

    test('returns the string unchanged if it exceeds the target length', () => {
      expect(padRight(2, 'abc')).toBe('abc');
    });

    test('uses the specified padding character', () => {
      expect(padRight(5, 'abc', '*')).toBe('abc**');
    });

    test('handles empty strings', () => {
      expect(padRight(3, '')).toBe('   ');
    });
  });

  describe('formatTime', () => {
    test('converts milliseconds to seconds and rounds to 2 decimal places', () => {
      expect(formatTime(1234)).toBe(1.23);
    });

    test('rounds up correctly', () => {
      expect(formatTime(1235)).toBe(1.24);
    });

    test('rounds down correctly', () => {
      expect(formatTime(1234.4)).toBe(1.23);
    });

    test('handles zero', () => {
      expect(formatTime(0)).toBe(0);
    });

    test('handles large numbers', () => {
      expect(formatTime(60000)).toBe(60);
    });

    test('handles decimal precision correctly', () => {
      expect(formatTime(1500)).toBe(1.5);
    });
  });
});
