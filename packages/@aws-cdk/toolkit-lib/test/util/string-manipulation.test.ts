import { padLeft, padRight, formatTime, formatReason } from '../../lib/util/string-manipulation';

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

  describe('formatReason', () => {
    test.each([
      ['Something went wrong', undefined, 'Something went wrong'],
      ['Error occurred', undefined, 'Error occurred'],
      ['  Valid reason  ', undefined, 'Valid reason'],
    ])('returns the reason when provided: %s', (reason, fallback, expected) => {
      expect(formatReason(reason, fallback)).toBe(expected);
    });

    test.each([
      [undefined, undefined, 'No reason provided'],
      [null, undefined, 'No reason provided'],
      ['', undefined, 'No reason provided'],
      ['   ', undefined, 'No reason provided'],
    ])('returns default fallback for invalid reasons: %s', (reason, fallback, expected) => {
      expect(formatReason(reason, fallback)).toBe(expected);
    });

    test.each([
      [undefined, 'Custom fallback message', 'Custom fallback message'],
      [null, 'Custom fallback message', 'Custom fallback message'],
      ['', 'Custom fallback message', 'Custom fallback message'],
      ['   ', 'Custom fallback message', 'Custom fallback message'],
      [undefined, 'no reason provided', 'no reason provided'],
      [null, 'Unknown error', 'Unknown error'],
    ])('returns custom fallback when provided: reason=%s, fallback=%s', (reason, fallback, expected) => {
      expect(formatReason(reason, fallback)).toBe(expected);
    });
  });
});
