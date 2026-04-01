/**
 * Custom Jest matchers for CLI integration tests.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      /**
       * Assert that the line following a matching line matches the expected pattern.
       */
      toHaveNextLineMatching(linePattern: string | RegExp, expected: string | RegExp): R;
    }
  }
}

function matches(line: string, pattern: string | RegExp): boolean {
  return typeof pattern === 'string' ? line.includes(pattern) : pattern.test(line);
}

expect.extend({
  toHaveNextLineMatching(received: string, linePattern: string | RegExp, expected: string | RegExp) {
    const lines = received.split('\n');
    const idx = lines.findIndex(l => matches(l, linePattern));

    if (idx < 0) {
      return {
        pass: false,
        message: () => `Expected output to contain a line matching ${linePattern}, but none was found`,
      };
    }

    const nextLine = lines[idx + 1] ?? '';
    const pass = matches(nextLine, expected);

    return {
      pass,
      message: () => pass
        ? `Expected line after ${linePattern} not to match ${expected}, but it did:\n  ${nextLine}`
        : `Expected line after ${linePattern} to match ${expected}, but got:\n  ${nextLine}`,
    };
  },
});
