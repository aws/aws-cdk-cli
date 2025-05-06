import { ciSystemIsStdErrSafe } from '../ci-systems';
import { isCI } from '../io-host';
import * as version from '../version';

export { isCI } from '../io-host';

/**
 * yargs middleware to negate an option if a negative alias is provided
 * E.g. `-R` will imply `--rollback=false`
 *
 * @param optionToNegate The name of the option to negate, e.g. `rollback`
 * @param negativeAlias The alias that should negate the option, e.g. `R`
 * @returns a middleware function that can be passed to yargs
 */
export function yargsNegativeAlias<T extends { [x in S | L]: boolean | undefined }, S extends string, L extends string>(
  negativeAlias: S,
  optionToNegate: L,
): (argv: T) => T {
  return (argv: T) => {
    // if R in argv && argv[R]
    // then argv[rollback] = false
    if (negativeAlias in argv && argv[negativeAlias]) {
      (argv as any)[optionToNegate] = false;
    }
    return argv;
  };
}

/**
 * Returns the current version of the CLI
 * @returns the current version of the CLI
 */
export function cliVersion(): string {
  return version.displayVersion();
}

/**
 * Returns the default browser command for the current platform
 * @returns the default browser command for the current platform
 */
export function browserForPlatform(): string {
  switch (process.platform) {
    case 'darwin':
      return 'open %u';
    case 'win32':
      return 'start %u';
    default:
      return 'xdg-open %u';
  }
}

/**
 * The default value for displaying (and refreshing) notices on all commands.
 *
 * If the user didn't supply either `--notices` or `--no-notices`, we do
 * autodetection. The autodetection currently is: do write notices if we are
 * not on CI, or are on a CI system where we know that writing to stderr is
 * safe. We fail "closed"; that is, we decide to NOT print for unknown CI
 * systems, even though technically we maybe could.
 */
export function shouldDisplayNotices(): boolean {
  return !isCI() || Boolean(ciSystemIsStdErrSafe());
}
