/**
 * Polyfill for `util.styleText` which was added in Node.js 20.12.0.
 *
 * This patches `util.styleText` on older Node.js versions (e.g. 18.x)
 * so that dependencies like @clack/prompts that rely on it can work.
 *
 * The implementation mirrors the Node.js upstream behavior:
 * - Looks up ANSI codes from `util.inspect.colors`
 * - Supports single format string or array of formats
 * - `'none'` format is a passthrough
 * - Replaces nested close codes so styles compose correctly
 * - Supports hex colors (#RGB / #RRGGBB) via 24-bit ANSI
 * - Supports `options.stream` / `options.validateStream` for color detection
 *
 * @see https://github.com/nodejs/node/blob/main/lib/util.js
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const util = require('node:util');

if (typeof util.styleText !== 'function') {
  const inspect = util.inspect;
  const colors: Record<string, [number, number]> = inspect.colors as any;

  const ESC = '\u001b[';

  // Codes that share close code 22
  const DIM_CODE = 2;
  const BOLD_CODE = 1;

  /**
   * When text contains a close sequence, replace it with close+reopen
   * so the style continues after nested resets. If the format is bold or dim
   * (which share close code 22), keep the close before reopening.
   */
  function replaceCloseCode(str: string, closeSeq: string, openSeq: string, keepClose: boolean): string {
    let index = str.indexOf(closeSeq);
    if (index === -1) return str;

    const closeLen = closeSeq.length;
    const replacement = keepClose ? closeSeq + openSeq : openSeq;
    let result = '';
    let lastIndex = 0;

    do {
      const afterClose = index + closeLen;
      if (afterClose < str.length) {
        result += str.slice(lastIndex, index) + replacement;
        lastIndex = afterClose;
      } else {
        break;
      }
      index = str.indexOf(closeSeq, lastIndex);
    } while (index !== -1);

    return result + str.slice(lastIndex);
  }

  const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  function hexToRgb(hex: string): [number, number, number] {
    let h: string;
    if (hex.length === 4) {
      h = hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    } else {
      h = hex.slice(1);
    }
    const n = parseInt(h, 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]; // eslint-disable-line no-bitwise
  }

  function shouldColorize(stream: any): boolean {
    if (stream && typeof stream.hasColors === 'function') {
      return stream.hasColors();
    }
    // Fall back to checking isTTY
    return !!(stream && stream.isTTY);
  }

  util.styleText = function styleText(
    format: string | string[],
    text: string,
    options?: { validateStream?: boolean; stream?: any },
  ): string {
    if (typeof text !== 'string') {
      throw new TypeError(`The "text" argument must be of type string. Received ${typeof text}`);
    }

    const validateStream = options?.validateStream ?? true;
    if (validateStream) {
      const stream = options?.stream ?? process.stdout;
      if (!shouldColorize(stream)) {
        return text;
      }
    }

    const formats = Array.isArray(format) ? format : [format];
    let openCodes = '';
    let closeCodes = '';
    let processedText = text;

    for (const key of formats) {
      if (key === 'none') continue;

      // Hex color support
      if (typeof key === 'string' && HEX_RE.test(key)) {
        const [r, g, b] = hexToRgb(key);
        const openSeq = `${ESC}38;2;${r};${g};${b}m`;
        const closeSeq = `${ESC}39m`;
        openCodes += openSeq;
        closeCodes = closeSeq + closeCodes;
        processedText = replaceCloseCode(processedText, closeSeq, openSeq, false);
        continue;
      }

      const code = colors[key];
      if (!code) {
        throw new TypeError(
          `The argument 'format' must be one of: ${Object.keys(colors).join(', ')}. Received '${key}'`,
        );
      }

      const openSeq = `${ESC}${code[0]}m`;
      const closeSeq = `${ESC}${code[1]}m`;
      const keepClose = code[0] === DIM_CODE || code[0] === BOLD_CODE;

      openCodes += openSeq;
      closeCodes = closeSeq + closeCodes;
      processedText = replaceCloseCode(processedText, closeSeq, openSeq, keepClose);
    }

    return `${openCodes}${processedText}${closeCodes}`;
  };
}
