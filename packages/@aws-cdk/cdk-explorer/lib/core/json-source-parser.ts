/**
 * A strict JSON parser that records where every value came from in the source
 * text, so a consumer can map a value back to a character range (and from there
 * to a line/column, which is the caller's business — see `OffsetRange` in
 * `template-ranges.ts`).
 *
 * Accepts exactly what `JSON.parse` accepts (RFC 8259): no comments, no trailing
 * commas, no single quotes, no unquoted keys. Anything else is a parse error.
 * The node shape deliberately mirrors the subset of `jsonc-parser`'s API we use,
 * so consumers read the same way: `type`/`offset`/`length`/`value`/`children`,
 * plus {@link findNodeAtLocation}.
 */

/** The kind of a {@link Node}. `property` is one `"key": value` member of an object. */
export type NodeType = 'object' | 'array' | 'property' | 'string' | 'number' | 'boolean' | 'null';

/** A parsed JSON value, tagged with the source range it was parsed from. */
export interface Node {
  readonly type: NodeType;
  /** Offset of the node's first character in the source text, 0-based. */
  readonly offset: number;
  /**
   * The node's length in characters, so it spans `[offset, offset + length)`.
   * A `property` spans its key through the end of its value, excluding the
   * separating comma.
   */
  readonly length: number;
  /**
   * The parsed value of a scalar node: the unescaped text of a `string`, the
   * numeric value of a `number`, `true`/`false`, or `null`. Absent for
   * `object`, `array` and `property` nodes.
   */
  readonly value?: string | number | boolean | null;
  /**
   * An `object`'s `property` nodes, an `array`'s element nodes, or a
   * `property`'s `[key, value]` pair, in document order. Absent for scalars.
   */
  readonly children?: Node[];
}

/**
 * Nesting depth we refuse to go past. Recursive descent means depth costs stack,
 * and a template is a handful of levels deep; this turns a pathological document
 * into a parse error instead of a crashed process.
 */
const MAX_DEPTH = 200;

/**
 * Parse `text` into a {@link Node} tree, or return `undefined` if it is not
 * valid JSON. All-or-nothing on purpose: a half-parsed document would hand out
 * ranges that do not mean what the caller thinks they mean.
 */
export function parseTree(text: string): Node | undefined {
  try {
    return new Parser(text).parseDocument();
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Walk `path` down from `node`, taking object keys for strings and array indices
 * for numbers, and return the node found there. `undefined` if any step is
 * missing or is the wrong kind of container.
 */
export function findNodeAtLocation(node: Node | undefined, path: Array<string | number>): Node | undefined {
  let current = node;
  for (const segment of path) {
    if (current === undefined) {
      return undefined;
    }
    current = typeof segment === 'string' ? objectMember(current, segment) : arrayElement(current, segment);
  }
  return current;
}

/** The value node of an object's `key` member, or `undefined`. Last duplicate key wins, like `JSON.parse`. */
function objectMember(node: Node, key: string): Node | undefined {
  if (node.type !== 'object') {
    return undefined;
  }
  let found: Node | undefined;
  for (const property of node.children ?? []) {
    if (property.children?.[0]?.value === key) {
      found = property.children[1];
    }
  }
  return found;
}

function arrayElement(node: Node, index: number): Node | undefined {
  return node.type === 'array' ? node.children?.[index] : undefined;
}

/** Thrown internally for any malformed input; {@link parseTree} turns it into `undefined`. */
class JsonSyntaxError extends Error {
  constructor(message: string, public readonly offset: number) {
    super(`${message} at offset ${offset}`);
  }
}

/**
 * A hand-written recursive-descent parser. Hand-written rather than built on
 * `JSON.parse` because offsets are the whole point, and `JSON.parse` does not
 * report them (its reviver sees values, not positions).
 */
class Parser {
  private pos = 0;

  constructor(private readonly text: string) {
  }

  /** A whole document: one value, surrounded by optional whitespace, nothing after it. */
  public parseDocument(): Node {
    this.skipWhitespace();
    const node = this.parseValue(0);
    this.skipWhitespace();
    if (this.pos !== this.text.length) {
      throw this.error('trailing content after the top-level value');
    }
    return node;
  }

  private parseValue(depth: number): Node {
    if (depth > MAX_DEPTH) {
      throw this.error('JSON nested too deeply');
    }
    switch (this.peek()) {
      case '{': return this.parseObject(depth);
      case '[': return this.parseArray(depth);
      case '"': return this.parseString();
      case 't': return this.parseLiteral('true', true);
      case 'f': return this.parseLiteral('false', false);
      case 'n': return this.parseLiteral('null', null);
      default: return this.parseNumber();
    }
  }

  private parseObject(depth: number): Node {
    const start = this.pos;
    this.expect('{');
    const children: Node[] = [];

    this.skipWhitespace();
    if (this.peek() !== '}') {
      for (;;) {
        this.skipWhitespace();
        children.push(this.parseProperty(depth));
        this.skipWhitespace();
        if (this.peek() !== ',') {
          break;
        }
        this.pos++;
      }
      this.skipWhitespace();
    }

    this.expect('}');
    return { type: 'object', offset: start, length: this.pos - start, children };
  }

  /** One `"key": value` member. Its range runs from the key's quote to the end of the value. */
  private parseProperty(depth: number): Node {
    const start = this.pos;
    if (this.peek() !== '"') {
      throw this.error('expected a quoted property name');
    }
    const key = this.parseString();

    this.skipWhitespace();
    this.expect(':');
    this.skipWhitespace();

    const value = this.parseValue(depth + 1);
    return { type: 'property', offset: start, length: this.pos - start, children: [key, value] };
  }

  private parseArray(depth: number): Node {
    const start = this.pos;
    this.expect('[');
    const children: Node[] = [];

    this.skipWhitespace();
    if (this.peek() !== ']') {
      for (;;) {
        this.skipWhitespace();
        children.push(this.parseValue(depth + 1));
        this.skipWhitespace();
        if (this.peek() !== ',') {
          break;
        }
        this.pos++;
      }
      this.skipWhitespace();
    }

    this.expect(']');
    return { type: 'array', offset: start, length: this.pos - start, children };
  }

  private parseString(): Node {
    const start = this.pos;
    this.expect('"');
    let value = '';

    for (;;) {
      const char = this.text[this.pos];
      if (char === undefined) {
        throw this.error('unterminated string');
      }
      if (char === '"') {
        this.pos++;
        return { type: 'string', offset: start, length: this.pos - start, value };
      }
      if (char === '\\') {
        value += this.readEscape();
        continue;
      }
      // Unescaped control characters are not legal in a JSON string.
      if (char < '\u0020') {
        throw this.error('control character in string');
      }
      value += char;
      this.pos++;
    }
  }

  /** Read one `\x` escape sequence, returning the character(s) it denotes. */
  private readEscape(): string {
    this.pos++; // the backslash
    const escape = this.text[this.pos++];
    switch (escape) {
      case '"': return '"';
      case '\\': return '\\';
      case '/': return '/';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'u': {
        const hex = this.text.slice(this.pos, this.pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw this.error('invalid unicode escape');
        }
        this.pos += 4;
        // One code unit at a time: a surrogate pair arrives as two escapes and
        // reassembles itself on concatenation, exactly like `JSON.parse`.
        return String.fromCharCode(parseInt(hex, 16));
      }
      default:
        throw this.error('invalid escape sequence');
    }
  }

  /**
   * A JSON number: `-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?`. No leading `+`, no
   * leading zeroes, no bare `.5` or `5.`, no `Infinity`/`NaN` — matching
   * `JSON.parse`, which is stricter than `Number()`.
   */
  private parseNumber(): Node {
    const start = this.pos;
    const match = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/.exec(this.text.slice(this.pos));
    if (match === null) {
      throw this.error('expected a value');
    }
    this.pos += match[0].length;
    return { type: 'number', offset: start, length: this.pos - start, value: Number(match[0]) };
  }

  private parseLiteral(word: string, value: boolean | null): Node {
    const start = this.pos;
    if (this.text.startsWith(word, this.pos)) {
      this.pos += word.length;
      return { type: value === null ? 'null' : 'boolean', offset: start, length: word.length, value };
    }
    throw this.error('expected a value');
  }

  /** The current character, or `undefined` at end of input. */
  private peek(): string | undefined {
    return this.text[this.pos];
  }

  private expect(char: string): void {
    if (this.text[this.pos] !== char) {
      throw this.error(`expected '${char}'`);
    }
    this.pos++;
  }

  /** JSON's whitespace is exactly these four characters. */
  private skipWhitespace(): void {
    while (this.pos < this.text.length) {
      const char = this.text[this.pos];
      if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') {
        return;
      }
      this.pos++;
    }
  }

  private error(message: string): JsonSyntaxError {
    return new JsonSyntaxError(message, this.pos);
  }
}
