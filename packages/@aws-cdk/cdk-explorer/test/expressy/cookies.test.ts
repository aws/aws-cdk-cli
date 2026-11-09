import { parseCookieValue, parseSetCookieValues, serializeCookieValue, serializeSetCookieValue } from '../../lib/expressy/cookies';

/**
 * Cookie handling is hand-rolled rather than pulled from `cookie-parser`, so
 * the parsing rules a browser relies on -- exact name matching, only the first
 * `=` separating name from value, attributes stripped from `Set-Cookie` -- are
 * pinned here.
 *
 * Malformed percent-encoding is deliberately not covered: `decodeURIComponent`
 * throws, `req.cookie()` converts that to `MalformedRequest`, and the session
 * middleware turns it into a 4xx. That chain is the request layer's business.
 */
describe('parseCookieValue', () => {
  test('returns nothing for an absent header', () => {
    expect(parseCookieValue(undefined)).toEqual({});
    expect(parseCookieValue(null)).toEqual({});
    expect(parseCookieValue('')).toEqual({});
  });

  test('reads a single cookie', () => {
    expect(parseCookieValue('session=abc123')).toEqual({ session: 'abc123' });
  });

  test('reads one cookie out of several, tolerating the spaces browsers insert', () => {
    expect(parseCookieValue('a=1; session=abc123; b=2')).toEqual({ a: '1', session: 'abc123', b: '2' });
  });

  test('joins a repeated header before parsing', () => {
    expect(parseCookieValue(['a=1', 'session=abc'])).toEqual({ a: '1', session: 'abc' });
  });

  test('matches a name exactly, not by prefix', () => {
    // `session_backup` must not be mistaken for `session`.
    expect(parseCookieValue('session_backup=wrong; session=right').session).toBe('right');
  });

  test('keeps a value containing "=" intact', () => {
    // Only the first `=` separates name from value; base64 padding is common.
    expect(parseCookieValue('session=YWJjZA==').session).toBe('YWJjZA==');
  });

  test('percent-decodes a value', () => {
    expect(parseCookieValue('session=a%20b').session).toBe('a b');
  });

  test('skips a segment with no "=" rather than inventing a cookie', () => {
    expect(parseCookieValue('flag; session=abc')).toEqual({ session: 'abc' });
  });
});

describe('serializeSetCookieValue', () => {
  test('emits just the pair when no attributes are given', () => {
    expect(serializeSetCookieValue('session', 'abc')).toBe('session=abc');
  });

  test('emits the attributes the explorer relies on', () => {
    expect(serializeSetCookieValue('session', 'abc', { path: '/', httpOnly: true, sameSite: 'strict' }))
      .toBe('session=abc; Path=/; HttpOnly; SameSite=Strict');
  });

  test('capitalizes the SameSite value as the header syntax expects', () => {
    expect(serializeSetCookieValue('s', 'v', { sameSite: 'lax' })).toContain('SameSite=Lax');
    expect(serializeSetCookieValue('s', 'v', { sameSite: 'none' })).toContain('SameSite=None');
  });

  test('omits a falsy httpOnly rather than emitting the flag', () => {
    expect(serializeSetCookieValue('s', 'v', { httpOnly: false })).toBe('s=v');
  });
});

describe('serializeCookieValue', () => {
  test('joins pairs into a Cookie header', () => {
    expect(serializeCookieValue({ a: '1', session: 'abc' })).toBe('a=1; session=abc');
  });

  test('round-trips a value needing escaping', () => {
    const header = serializeCookieValue({ session: 'a b;c' });

    expect(parseCookieValue(header).session).toBe('a b;c');
  });
});

describe('parseSetCookieValues', () => {
  test('returns nothing for an absent header', () => {
    expect(parseSetCookieValues(undefined)).toEqual({});
  });

  test('reads a single Set-Cookie header, dropping its attributes', () => {
    expect(parseSetCookieValues('session=abc; Path=/; HttpOnly')).toEqual({ session: 'abc' });
  });

  test('reads every header when several are sent', () => {
    expect(parseSetCookieValues(['a=1; Path=/', 'session=abc; HttpOnly'])).toEqual({ a: '1', session: 'abc' });
  });

  test('keeps a value containing "=" intact', () => {
    // Splitting on every `=` would truncate a padded base64 value.
    expect(parseSetCookieValues('session=YWJjZA==; Path=/')).toEqual({ session: 'YWJjZA==' });
  });
});
