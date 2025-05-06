/* eslint-disable no-console */
import * as chalk from 'chalk';

/* c8 ignore start */
export function prettyPrintError(error: unknown, debug = false) {
  const err = ensureError(error);
  console.error(chalk.red(err.message));

  if (err.cause) {
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
