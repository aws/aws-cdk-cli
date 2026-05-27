import { LineParser } from '../../lib/daemon/line-parser';

describe('LineParser', () => {
  test('parses complete lines', () => {
    const parser = new LineParser<{ value: number }>();
    const results = parser.feed('{"value":1}\n{"value":2}\n');
    expect(results).toEqual([{ value: 1 }, { value: 2 }]);
  });

  test('buffers partial lines across feeds', () => {
    const parser = new LineParser<{ value: number }>();
    expect(parser.feed('{"val')).toEqual([]);
    expect(parser.feed('ue":42}\n')).toEqual([{ value: 42 }]);
  });

  test('discards malformed JSON lines', () => {
    const parser = new LineParser<{ value: number }>();
    const results = parser.feed('not-json\n{"value":1}\n');
    expect(results).toEqual([{ value: 1 }]);
  });

  test('skips empty lines', () => {
    const parser = new LineParser<{ value: number }>();
    const results = parser.feed('\n\n{"value":1}\n\n');
    expect(results).toEqual([{ value: 1 }]);
  });

  test('prepend injects data before buffer', () => {
    const parser = new LineParser<{ value: number }>();
    parser.prepend('{"value":1}\n{"val');
    const results = parser.feed('ue":2}\n');
    expect(results).toEqual([{ value: 1 }, { value: 2 }]);
  });

  test('remainder returns unparsed data', () => {
    const parser = new LineParser<{ value: number }>();
    parser.feed('{"value":1}\npartial');
    expect(parser.remainder).toBe('partial');
  });
});
