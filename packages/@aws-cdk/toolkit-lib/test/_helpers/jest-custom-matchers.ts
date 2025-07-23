import { strict as assert } from 'node:assert';

type TestableError = string | RegExp | Error;

declare global {
  namespace jest {
    interface AsymmetricMatchers {
      toThrowWithCause(error: TestableError, cause: TestableError): void;
    }

    interface Matchers<R> {
      toThrowWithCause(error: TestableError, cause: TestableError): R;
    }
  }
}

/**
 * @type {ExpectExtendMap & MatchersExtend<any>}
 */
const customMatchers = {
  toThrowWithCause(received: any, error: TestableError, cause: TestableError) {
    // check the main error first
    expect(() => {
      throw received;
    }).toThrow(error);

    let pass = true;
    try {
      assert(received.cause);
      expect(() => {
        throw received.cause;
      }).toThrow(cause);
    } catch {
      pass = false;
    }

    const actualCause = String(received && received.cause ? `got: ${received.cause}` : 'no cause was found');

    return {
      pass,
      message: pass
        // not.toThrowWithCause
        ? () => `Expected callback not to throw an Error with cause '${cause}'`
        // .toThrowWithCause
        : () => `Expected callback to throw an Error with cause '${cause}', but ${actualCause}`,
    };
  },
};

expect.extend(customMatchers);

export {};
