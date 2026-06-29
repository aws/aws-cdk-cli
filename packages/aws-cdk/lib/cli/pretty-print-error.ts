/* eslint-disable no-console */
import * as chalk from 'chalk';

/* c8 ignore start */
export function prettyPrintError(error: unknown, options: { soft?: boolean; debug?: boolean } = {}) {
  const err = ensureError(error);
  const debug = options.debug ?? false;
  const soft = options.soft ?? false;

  // A soft error (for example a user-declined confirmation) is an expected outcome, not a crash.
  // Present the message less scary.
  const errorPaint = soft ? chalk.yellow : chalk.red;

  console.error(errorPaint(err.message));
  if (err.cause && !soft) {
    const cause = ensureError(err.cause);
    console.error(chalk.yellow(cause.message));
    printTrace(cause, debug);
  }

  printTrace(err, debug);
}

function printTrace(err: Error, debug = false) {
  // Log the stack trace if we're on a developer workstation. Otherwise this will be into a minified
  // file and the printed code line and stack trace are huge and useless.
  if (err.stack && debug) {
    console.debug(chalk.gray(err.stack));
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
