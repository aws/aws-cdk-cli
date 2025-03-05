import * as crypto from 'crypto';
import { contentHash, contentHashAny } from '../../src/util/content-hash';

describe('contentHash', () => {
  test('hashes string data correctly', () => {
    const data = 'test string';
    const expected = crypto.createHash('sha256').update(data).digest('hex');
    expect(contentHash(data)).toEqual(expected);
  });

  test('hashes Buffer data correctly', () => {
    const data = Buffer.from('test buffer');
    const expected = crypto.createHash('sha256').update(data).digest('hex');
    expect(contentHash(data)).toEqual(expected);
  });

  test('hashes DataView data correctly', () => {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, 42);
    const expected = crypto.createHash('sha256').update(view).digest('hex');
    expect(contentHash(view)).toEqual(expected);
  });

  test('produces consistent output for identical inputs', () => {
    const data = 'consistent data';
    expect(contentHash(data)).toEqual(contentHash(data));
  });

  test('produces different output for different inputs', () => {
    expect(contentHash('data1')).not.toEqual(contentHash('data2'));
  });
});

describe('contentHashAny', () => {
  test('hashes primitive string correctly', () => {
    const value = 'test string';
    const result = contentHashAny(value);
    expect(result).toMatch(/^[a-f0-9]{64}$/); // sha256 produces 64 hex chars
  });

  test('hashes primitive number correctly', () => {
    const value = 123;
    const result = contentHashAny(value);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  test('hashes primitive boolean correctly', () => {
    const value = true;
    const result = contentHashAny(value);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  test('hashes null and undefined correctly', () => {
    expect(contentHashAny(null)).toMatch(/^[a-f0-9]{64}$/);
    expect(contentHashAny(undefined)).toMatch(/^[a-f0-9]{64}$/);
  });

  test('hashes arrays correctly', () => {
    const value = ['a', 'b', 'c'];
    const result = contentHashAny(value);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  test('hashes nested arrays correctly', () => {
    const value = ['a', ['b', 'c'], 'd'];
    const result = contentHashAny(value);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  test('hashes objects correctly', () => {
    const value = { a: 1, b: 2, c: 3 };
    const result = contentHashAny(value);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  test('hashes nested objects correctly', () => {
    const value = { a: 1, b: { c: 2, d: 3 }, e: 4 };
    const result = contentHashAny(value);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  test('hashes complex mixed structures correctly', () => {
    const value = {
      a: 1,
      b: ['x', 'y', 'z'],
      c: { d: true, e: [1, 2, { f: 'g' }] },
      h: null,
    };
    const result = contentHashAny(value);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  test('produces consistent output for identical inputs', () => {
    const value = { a: 1, b: [2, 3], c: { d: 4 } };
    expect(contentHashAny(value)).toEqual(contentHashAny(value));
  });

  test('produces different output for different inputs', () => {
    const value1 = { a: 1, b: 2 };
    const value2 = { a: 1, b: 3 };
    expect(contentHashAny(value1)).not.toEqual(contentHashAny(value2));
  });

  test('produces same hash regardless of object property order', () => {
    const value1 = { a: 1, b: 2, c: 3 };
    const value2 = { c: 3, a: 1, b: 2 };
    expect(contentHashAny(value1)).toEqual(contentHashAny(value2));
  });

  test('distinguishes between string and number values', () => {
    expect(contentHashAny('123')).not.toEqual(contentHashAny(123));
  });

  test('distinguishes between empty arrays and objects', () => {
    expect(contentHashAny([])).not.toEqual(contentHashAny({}));
  });
});
