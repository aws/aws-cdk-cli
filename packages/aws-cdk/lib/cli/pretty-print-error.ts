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

/* c8 ignore start */
export function prettyPrintError(error: unknown, options: PrettyErrorPrinterOptions = { soft: false, debug: false }) {
  const err = ensureError(error);

  // A soft error (for example a user-declined confirmation) is an expected outcome, not a crash.
  // Present the message less scary.
  const errorPaint = options.soft ? chalk.yellow : chalk.red;

  console.error(errorPaint(err.message));
  printCauses(err, options);

  // Log the stack trace if we're on a developer workstation. Otherwise this will be into a minified
  // file and the printed code line and stack trace are huge and useless.
  if (options.debug) {
    printTraces(err);
  }
}

/**
 * Recursively print all error causes recursively.
 */
function printCauses(err: Error, options: PrettyErrorPrinterOptions) {
  if (err.cause && !options.soft) {
    const cause = ensureError(err.cause);
    console.error(chalk.yellow(`‣ ${cause.name}: ${cause.message}`));
    printCauses(cause, options);
  }
}

/**
 * Recursively print all error traces.
 */
function printTraces(err: Error) {
  if (err.stack) {
    console.debug(chalk.gray(err.stack));
  }
  if (err.cause) {
    printTraces(ensureError(err.cause));
  }
}

function ensureError(value: unknown): Error {
  if (value instanceof Error) return value;

  let stringified = '[Unable to stringify the thrown value]';
  try {
    stringified = JSON.stringify(value);
  } catch {
  }

  const error = new Error(`An unexpected error was thrown: ${stringified}`);
  return error;
}
/* c8 ignore stop */
