import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { prettyPrintError } from '../../lib/cli/pretty-print-error';

/**
 * `ensureError` is deliberately NOT exported: these tests drive it through the only production
 * entry point, `prettyPrintError`, so that what is asserted is exactly what a user sees on stderr.
 *
 * Output is captured with `jest.spyOn(console, ...)` and NOT by patching `process.stderr.write`:
 * the buffered-console test environment (test/_helpers/jest-bufferedconsole.ts) replaces the stream
 * write functions, so a stream-patching test would observe an empty string and pass vacuously.
 */

const SENTINEL_SECRET = 'sentinel-secret-access-key-must-never-be-printed';
const SENTINEL_TOKEN = 'sentinel-session-token-must-never-be-printed';

let errorSpy: jest.SpyInstance;
let debugSpy: jest.SpyInstance;

beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
  });
  debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function printed(): string {
  return [...errorSpy.mock.calls, ...debugSpy.mock.calls]
    .map((call) => call.map((arg) => String(arg)).join(' '))
    .join('\n');
}

function secretBearingObject() {
  return {
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'not-a-real-key-id',
      secretAccessKey: SENTINEL_SECRET,
      sessionToken: SENTINEL_TOKEN,
    },
  };
}

describe('values that carry secrets', () => {
  test('a thrown object is described by its type only', () => {
    prettyPrintError(secretBearingObject());

    expect(printed()).toContain('An unexpected error was thrown');
    expect(printed()).toContain("a value of type 'object'");
    expect(printed()).not.toContain(SENTINEL_SECRET);
    expect(printed()).not.toContain(SENTINEL_TOKEN);
  });

  test('an object carried as Error cause is described by its type only', () => {
    // This is the real reachability path: PluginHost wraps whatever a plugin's init() threw.
    const error = ToolkitError.withCause('PluginLoadFailed', "Unable to load plug-in '/tmp/the-plugin'", secretBearingObject());

    prettyPrintError(error);

    expect(printed()).toContain("Unable to load plug-in '/tmp/the-plugin'");
    expect(printed()).toContain('An unexpected error was thrown');
    expect(printed()).not.toContain(SENTINEL_SECRET);
    expect(printed()).not.toContain(SENTINEL_TOKEN);
  });

  test('an object nested deeper in the cause chain is described by its type only', () => {
    const inner = ToolkitError.withCause('PluginLoadFailed', 'inner failure', secretBearingObject());
    const outer = ToolkitError.withCause('CliError', 'outer failure', inner);

    prettyPrintError(outer);

    expect(printed()).toContain('outer failure');
    expect(printed()).toContain('inner failure');
    expect(printed()).not.toContain(SENTINEL_SECRET);
    expect(printed()).not.toContain(SENTINEL_TOKEN);
  });

  test('a thrown string is described by its type only', () => {
    prettyPrintError(`credentials: ${SENTINEL_SECRET}`);

    expect(printed()).toContain("a value of type 'string'");
    expect(printed()).not.toContain(SENTINEL_SECRET);
  });
});

describe('hostile values do not crash the printer', () => {
  function cyclic() {
    const value: any = { secretAccessKey: SENTINEL_SECRET };
    value.self = value;
    return value;
  }

  function throwingToJson() {
    return {
      secretAccessKey: SENTINEL_SECRET,
      toJSON() {
        throw new Error(`toJSON exploded with ${SENTINEL_SECRET}`);
      },
    };
  }

  function throwingGetter() {
    return {
      get secretAccessKey(): string {
        throw new Error(`getter exploded with ${SENTINEL_SECRET}`);
      },
    };
  }

  function revokedProxy() {
    const { proxy, revoke } = Proxy.revocable({ secretAccessKey: SENTINEL_SECRET }, {});
    revoke();
    return proxy;
  }

  const cases: Array<[string, () => unknown]> = [
    ['cyclic object', cyclic],
    ['object with a throwing toJSON', throwingToJson],
    ['object with a throwing getter', throwingGetter],
    ['revoked proxy', revokedProxy],
    ['bigint', () => BigInt(42)],
    ['symbol', () => Symbol(SENTINEL_SECRET)],
    ['function', () => function named() {
      return SENTINEL_SECRET;
    }],
    ['null', () => null],
    ['undefined', () => undefined],
  ];

  test.each(cases)('%s is printed safely', (_name, makeValue) => {
    expect(() => prettyPrintError(makeValue(), { soft: false, debug: true })).not.toThrow();

    expect(printed()).toContain('An unexpected error was thrown');
    expect(printed()).not.toContain(SENTINEL_SECRET);
  });

  test('a revoked proxy as Error cause is printed safely', () => {
    const { proxy, revoke } = Proxy.revocable({ secretAccessKey: SENTINEL_SECRET }, {});
    revoke();
    const error = ToolkitError.withCause('PluginLoadFailed', 'plugin blew up', proxy);

    expect(() => prettyPrintError(error, { soft: false, debug: true })).not.toThrow();

    expect(printed()).toContain('plugin blew up');
    expect(printed()).not.toContain(SENTINEL_SECRET);
  });

  test('an Error whose message, stack and cause getters all throw is printed safely', () => {
    // Built with Object.create so that no stack is captured: it still passes `instanceof Error`,
    // but defining a throwing `stack` getter on a real Error would make source-map-support read
    // the throwing `message` getter while the test is still setting the object up.
    const error: Error = Object.create(Error.prototype);
    for (const property of ['message', 'stack', 'cause']) {
      Object.defineProperty(error, property, {
        get() {
          throw new Error(`${property} getter exploded with ${SENTINEL_SECRET}`);
        },
      });
    }

    expect(() => prettyPrintError(error, { soft: false, debug: true })).not.toThrow();

    expect(printed()).toContain('<no error message available>');
    expect(printed()).not.toContain(SENTINEL_SECRET);
  });

  test('a cause chain that loops back on itself terminates', () => {
    const first: any = new Error('first');
    const second: any = new Error('second');
    first.cause = second;
    second.cause = first;

    expect(() => prettyPrintError(first, { soft: false, debug: true })).not.toThrow();

    expect(printed()).toContain('first');
    expect(printed()).toContain('second');
  });

  test('a failure while writing to the console is swallowed', () => {
    // prettyPrintError runs inside the CLI's top-level catch; throwing from here would turn a
    // handled error into an unhandled rejection and skip the telemetry flush that follows it.
    errorSpy.mockImplementation(() => {
      throw new Error('EPIPE');
    });
    debugSpy.mockImplementation(() => {
      throw new Error('EPIPE');
    });

    expect(() => prettyPrintError(new Error('boom'), { soft: false, debug: true })).not.toThrow();
  });
});

describe('ordinary errors are unchanged', () => {
  test('the message is printed as-is', () => {
    prettyPrintError(new Error('something went wrong'));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(printed()).toContain('something went wrong');
  });

  test('causes are printed as name and message', () => {
    const error = ToolkitError.withCause('CliError', 'outer', new Error('inner'));

    prettyPrintError(error);

    expect(printed()).toContain('outer');
    expect(printed()).toContain('‣ Error: inner');
  });

  test('a non-Error cause keeps producing output for the outer error', () => {
    const error = ToolkitError.withCause('CliError', 'outer', 'just a string');

    prettyPrintError(error);

    expect(printed()).toContain('outer');
    expect(printed()).toContain("a value of type 'string'");
  });

  test('a falsy cause is not treated as a cause', () => {
    const error = new Error('outer', { cause: '' });

    prettyPrintError(error);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(printed()).toContain('outer');
  });

  test('soft errors do not print causes', () => {
    const error = ToolkitError.withCause('CliError', 'declined', new Error('inner'));

    prettyPrintError(error, { soft: true, debug: false });

    expect(printed()).toContain('declined');
    expect(printed()).not.toContain('inner');
  });

  test('stack traces are printed only in debug mode', () => {
    prettyPrintError(new Error('with a stack'), { soft: false, debug: false });
    expect(debugSpy).not.toHaveBeenCalled();

    prettyPrintError(new Error('with a stack'), { soft: false, debug: true });
    expect(debugSpy).toHaveBeenCalled();
    expect(printed()).toContain('pretty-print-error.test.ts');
  });

  test('stack traces of causes are printed in debug mode', () => {
    const error = ToolkitError.withCause('CliError', 'outer', new Error('inner'));

    prettyPrintError(error, { soft: false, debug: true });

    expect(debugSpy).toHaveBeenCalledTimes(2);
  });
});
