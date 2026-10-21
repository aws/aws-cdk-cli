import { findNodeAtLocation, parseTree, type Node } from '../../lib/core/json-source-parser';

/**
 * The oracle for every range in this suite: a node's range is correct iff the
 * substring it selects re-parses (with the real `JSON.parse`) to the value the
 * node stands for. No hand-counted offsets anywhere.
 */
function sliceOf(text: string, node: Node): string {
  return text.slice(node.offset, node.offset + node.length);
}

function parse(text: string): Node {
  const root = parseTree(text);
  expect(root).toBeDefined();
  return root!;
}

describe('accepts whatever JSON.parse accepts', () => {
  // Round-trip: for each document, every node's slice must re-parse to its value.
  const documents: Record<string, unknown> = {
    'an object': { a: 1, b: 'two', c: true, d: null },
    'an array': [1, 2, [3, [4]]],
    'nested objects': { a: { b: { c: { d: [] } } } },
    'an empty object': {},
    'an empty array': [],
    'a top-level string': 'hello',
    'a top-level number': 42,
    'a top-level boolean': false,
    'a top-level null': null,
    'strings with escapes': { s: 'quote " backslash \\ slash / tab \t newline \n brace }' },
    'strings with unicode': { s: 'caf\u00e9 \u2603 \ud83d\ude00' },
    'numbers of every shape': [0, -0, 1, -1, 1.5, -1.5, 1e10, 1e-10, 1.5e+10, -0.0001, 1e999],
    'deeply quoted keys': { 'a.b/c~d': 1, '': 2, '\u00e9': 3 },
  };

  test.each(Object.entries(documents))('%s round-trips every node', (_name, value) => {
    // Two serializations, because indentation changes every offset.
    for (const text of [JSON.stringify(value), JSON.stringify(value, undefined, 1)]) {
      expectNodeSlicesReparse(text, parse(text));
    }
  });

  /** Every node in the tree must slice to text that re-parses to that node's value. */
  function expectNodeSlicesReparse(text: string, node: Node): void {
    if (node.type === 'property') {
      const [key, value] = node.children!;
      // A property spans `"key": value`, which is an object body: brace it to re-parse.
      expect(JSON.parse(`{${sliceOf(text, node)}}`)).toEqual({ [key.value as string]: JSON.parse(sliceOf(text, value)) });
    } else {
      expect(JSON.parse(sliceOf(text, node))).toEqual(nodeValue(node));
    }
    for (const child of node.children ?? []) {
      expectNodeSlicesReparse(text, child);
    }
  }

  /** The plain JS value a node stands for, rebuilt from the tree alone. */
  function nodeValue(node: Node): unknown {
    switch (node.type) {
      case 'object':
        return Object.fromEntries((node.children ?? []).map((p) => [p.children![0].value, nodeValue(p.children![1])]));
      case 'array':
        return (node.children ?? []).map(nodeValue);
      default:
        return node.value;
    }
  }
});

describe('node shape', () => {
  test('an object has one property child per member, in document order', () => {
    const root = parse('{"a": 1, "b": 2}');

    expect(root.type).toBe('object');
    expect(root.children!.map((p) => p.children![0].value)).toEqual(['a', 'b']);
    expect(root.children!.every((p) => p.type === 'property')).toBe(true);
  });

  test('a property range covers the key through the value, excluding the comma', () => {
    const text = '{"a": 1, "b": 2}';
    const [a, b] = parse(text).children!;

    expect(sliceOf(text, a)).toBe('"a": 1');
    expect(sliceOf(text, b)).toBe('"b": 2');
  });

  test('a string node range includes both quotes, and its value is unescaped', () => {
    const text = '{"k": "a\\"b\\n"}';
    const value = parse(text).children![0].children![1];

    expect(sliceOf(text, value)).toBe('"a\\"b\\n"');
    expect(value.value).toBe('a"b\n');
  });

  test('scalar node types are tagged', () => {
    const root = parse('[1, "s", true, false, null, {}, []]');

    expect(root.children!.map((c) => c.type))
      .toEqual(['number', 'string', 'boolean', 'boolean', 'null', 'object', 'array']);
  });

  test('scalars carry their parsed value, containers do not', () => {
    const root = parse('[1.5, "s", true, null, {}]');

    expect(root.children!.map((c) => c.value)).toEqual([1.5, 's', true, null, undefined]);
  });

  test('a surrogate pair escape becomes one astral character', () => {
    const value = parse('{"k": "\\ud83d\\ude00"}').children![0].children![1];

    expect(value.value).toBe('\u{1f600}');
  });

  test('offsets are relative to the whole document, including leading whitespace', () => {
    const text = '\n\n   {"a": 1}';
    const root = parse(text);

    expect(root.offset).toBe(5);
    expect(sliceOf(text, root)).toBe('{"a": 1}');
  });

  test('a duplicate key keeps both properties in the tree', () => {
    // JSON.parse resolves last-wins; the tree is positional, so both survive and
    // lookups pick the last (see findNodeAtLocation).
    const root = parse('{"a": 1, "a": 2}');

    expect(root.children).toHaveLength(2);
  });
});

describe('rejects what JSON.parse rejects', () => {
  const invalid: Record<string, string> = {
    'a trailing comma in an object': '{"a": 1,}',
    'a trailing comma in an array': '[1,]',
    'a line comment': '{"a": 1} // hi',
    'a block comment': '{/* hi */ "a": 1}',
    'a single-quoted string': "{'a': 1}",
    'an unquoted key': '{a: 1}',
    'an unterminated string': '{"a": "x}',
    'an unterminated object': '{"a": 1',
    'an unterminated array': '[1, 2',
    'a missing colon': '{"a" 1}',
    'a missing comma': '{"a": 1 "b": 2}',
    'a bare word': 'nope',
    'empty text': '',
    'only whitespace': '   \n ',
    'trailing content': '{"a": 1} {"b": 2}',
    'a leading plus': '+1',
    'a leading zero': '01',
    'a bare fraction': '.5',
    'a trailing decimal point': '5.',
    'a hex number': '0x10',
    'Infinity': 'Infinity',
    'NaN': 'NaN',
    'an undefined literal': 'undefined',
    'a capitalized literal': 'True',
    'a raw newline in a string': '{"a": "x\ny"}',
    'a raw tab in a string': '{"a": "x\ty"}',
    'an invalid escape': '{"a": "\\q"}',
    'a short unicode escape': '{"a": "\\u12"}',
    'a non-hex unicode escape': '{"a": "\\uZZZZ"}',
    'a missing value': '{"a": }',
    'a stray closing brace': '}',
  };

  test.each(Object.entries(invalid))('%s', (_name, text) => {
    expect(parseTree(text)).toBeUndefined();
    // The oracle: whatever JSON.parse refuses, we refuse.
    expect(() => JSON.parse(text)).toThrow();
  });

  test('rejects nesting deeper than the depth limit instead of overflowing the stack', () => {
    const deep = '['.repeat(5000) + ']'.repeat(5000);

    expect(parseTree(deep)).toBeUndefined();
  });

  test('accepts nesting up to a depth a real template might reach', () => {
    const text = '['.repeat(100) + ']'.repeat(100);

    expect(parseTree(text)).toBeDefined();
  });
});

describe('findNodeAtLocation', () => {
  const TEXT = JSON.stringify({
    Resources: { Topic: { Type: 'AWS::SNS::Topic', Properties: { Tags: [{ Key: 'k' }] } } },
  }, undefined, 1);
  const ROOT = parse(TEXT);

  test('walks object keys', () => {
    const node = findNodeAtLocation(ROOT, ['Resources', 'Topic', 'Type'])!;

    expect(node.value).toBe('AWS::SNS::Topic');
  });

  test('walks array indices', () => {
    const node = findNodeAtLocation(ROOT, ['Resources', 'Topic', 'Properties', 'Tags', 0, 'Key'])!;

    expect(node.value).toBe('k');
  });

  test('the node it returns slices to that subtree', () => {
    const node = findNodeAtLocation(ROOT, ['Resources', 'Topic'])!;

    expect(JSON.parse(sliceOf(TEXT, node))).toEqual({ Type: 'AWS::SNS::Topic', Properties: { Tags: [{ Key: 'k' }] } });
  });

  test('returns undefined for a missing key, a missing index, or the wrong container kind', () => {
    expect(findNodeAtLocation(ROOT, ['Nope'])).toBeUndefined();
    expect(findNodeAtLocation(ROOT, ['Resources', 'Topic', 'Properties', 'Tags', 7])).toBeUndefined();
    // An object indexed as an array, and an array indexed as an object.
    expect(findNodeAtLocation(ROOT, ['Resources', 0])).toBeUndefined();
    expect(findNodeAtLocation(ROOT, ['Resources', 'Topic', 'Properties', 'Tags', 'Key'])).toBeUndefined();
    // Walking past a scalar.
    expect(findNodeAtLocation(ROOT, ['Resources', 'Topic', 'Type', 'more'])).toBeUndefined();
  });

  test('returns the root for an empty path, and undefined for an undefined root', () => {
    expect(findNodeAtLocation(ROOT, [])).toBe(ROOT);
    expect(findNodeAtLocation(undefined, ['Resources'])).toBeUndefined();
  });

  test('a duplicate key resolves to the last one, like JSON.parse', () => {
    const text = '{"a": 1, "a": 2}';

    expect(findNodeAtLocation(parse(text), ['a'])!.value).toBe(JSON.parse(text).a);
  });
});
