import type { Writable } from 'stream';
import * as util from 'util';
import chalk from 'chalk';

type StyleFn = (str: string) => string;
const { stderr } = process;

/**
 * The verbosity at or below which only errors and the run summary are printed (`-qq`)
 */
const ERRORS_ONLY_VERBOSITY = -2;

/**
 * Whether only errors and the run summary are printed at this verbosity (`-qq`)
 */
export function isErrorsOnly(verbosity: number = 0): boolean {
  return verbosity <= ERRORS_ONLY_VERBOSITY;
}

let currentVerbosity = 0;

/**
 * Set the verbosity for this process.
 *
 * Positive numbers are the number of `--verbose` flags, negative numbers the number of `--quiet` flags.
 * At `-2` and below, only errors and messages from `always` are printed.
 */
export function setVerbosity(verbosity: number) {
  currentVerbosity = verbosity;
}

const logger = (stream: Writable, styles?: StyleFn[], hideWhenErrorsOnly = true) => (fmt: string, ...args: any[]) => {
  if (hideWhenErrorsOnly && isErrorsOnly(currentVerbosity)) {
    return;
  }
  let str = util.format(fmt, ...args);
  if (styles && styles.length) {
    str = styles.reduce((a, style) => style(a), str);
  }
  stream.write(str + '\n');
};

export const print = logger(stderr);
export const error = logger(stderr, [chalk.red], false);
export const warning = logger(stderr, [chalk.yellow]);
export const success = logger(stderr, [chalk.green]);
export const highlight = logger(stderr, [chalk.bold]);
export const trace = logger(stderr, [chalk.gray]);

/**
 * Loggers for messages that are printed at every verbosity,
 * e.g. the run summary or details explaining why the run failed.
 */
export const always = {
  print: logger(stderr, [], false),
  warning: logger(stderr, [chalk.yellow], false),
  highlight: logger(stderr, [chalk.bold], false),
};
