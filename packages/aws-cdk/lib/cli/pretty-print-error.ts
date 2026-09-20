/* eslint-disable no-console */
import chalk from 'chalk';

interface PrettyErrorPrinterOptions {
  /**
   * Print the error as an expected outcome, for example when a user declined a confirmation prompt.
   * While thrown as exceptions, these should visually not be presented as a crash.
   */
  readonly soft: boolean;
  /**
   * Prints as much debug output as possible.
   */
  readonly debug: boolean;
}

const NO_MESSAGE = '<no error message available>';

export function prettyPrintError(error: unknown, options: PrettyErrorPrinterOptions = { soft: false, debug: false }) {
  const err = ensureError(error);

  // A soft error (for example a user-declined confirmation) is an expected outcome, not a crash.
  // Present the message less scary.
  const errorPaint = options.soft ? chalk.yellow : chalk.red;

  printError(readString(() => err.message, NO_MESSAGE), errorPaint);
  printCauses(err, options);

  // Log the stack trace if we're on a developer workstation. Otherwise this will be into a minified
  // file and the printed code line and stack trace are huge and useless.
  if (options.debug) {
    printTraces(err);
  }
}

/**
 * Print all error causes.
 */
function printCauses(err: Error, options: PrettyErrorPrinterOptions) {
  if (options.soft) {
    return;
  }

  // Iterative with a seen-set rather than recursive: a cause chain that loops back on itself would
  // otherwise recurse until the stack overflows, and that throw would escape our caller.
  const seen = new Set<unknown>();
  let current = readValue(() => err.cause as unknown);

  while (current && !seen.has(current)) {
    seen.add(current);
    const cause = ensureError(current);
    printError(`‣ ${readString(() => cause.name, 'Error')}: ${readString(() => cause.message, NO_MESSAGE)}`, chalk.yellow);
    current = readValue(() => cause.cause as unknown);
  }
}

/**
 * Print the stack traces of an error and all of its causes.
 */
function printTraces(err: Error) {
  const seen = new Set<unknown>();
  let current: unknown = err;

  while (current && !seen.has(current)) {
    seen.add(current);
    const error = ensureError(current);
    const stack = readString(() => error.stack, '');
    if (stack) {
      printDebug(stack, chalk.gray);
    }
    current = readValue(() => error.cause as unknown);
  }
}

function ensureError(value: unknown): Error {
  try {
    if (value instanceof Error) {
      return value;
    }
  } catch {
    // `instanceof` walks the prototype chain, which throws for exotic values such as a revoked
    // Proxy. Treat that as "not an Error" instead of letting the throw escape.
  }

  return new Error(`An unexpected error was thrown: a value of type '${describeValueType(value)}'. Its contents are not shown because they may contain credentials.`);
}

/**
 * Describe a value by its type only.
 *
 * Do NOT stringify, inspect or traverse the thrown value: it may hold AWS credentials that a
 * credential plugin returned, and everything printed here goes to stderr and ends up in CI logs.
 * `typeof` is the only classification that neither reads properties (property names
 * can themselves be secrets, and getters can throw) nor trips proxy traps.
 */
function describeValueType(value: unknown): string {
  try {
    if (value === null) {
      return 'null';
    }
    return typeof value;
  } catch {
    return 'unknown';
  }
}

/**
 * Read a property off a value that is not trusted to have well-behaved accessors.
 */
function readValue<A>(read: () => A): A | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * Read a string property off a value that is not trusted to have well-behaved accessors.
 *
 * Non-string values are replaced by `fallback` rather than coerced, because coercing them would
 * call `toString()` on the untrusted value.
 */
function readString(read: () => unknown, fallback: string): string {
  const value = readValue(read);
  return typeof value === 'string' ? value : fallback;
}

// Printing must never throw: prettyPrintError runs inside the CLI's top-level catch, so an
// exception here would turn a handled error into an unhandled rejection and skip the telemetry
// flush that happens after it.
function printError(text: string, paint: (s: string) => string) {
  try {
    console.error(paint(text));
  } catch {
  }
}

function printDebug(text: string, paint: (s: string) => string) {
  try {
    console.debug(paint(text));
  } catch {
  }
}
