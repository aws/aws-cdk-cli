import { runUserCommandLine } from '@aws-cdk/private-tools/lib/subprocess';
import chalk from 'chalk';
import type { IoHelper } from '../api-private';

export const command = 'docs';
export const describe = 'Opens the reference documentation in a browser';
export const aliases = ['doc'];

/**
 * Options for the docs command
 */
export interface DocsOptions {
  /**
   * The command to use to open the browser
   */
  readonly browser: string;

  /**
   * IoHelper for messaging
   */
  readonly ioHelper: IoHelper;
}

export async function docs(options: DocsOptions): Promise<number> {
  const ioHelper = options.ioHelper;
  const url = 'https://docs.aws.amazon.com/cdk/api/v2/';
  await ioHelper.defaults.info(chalk.green(url));
  // The browser command is the user's own `--browser` option (with %u replaced
  // by the constant docs URL) and may rely on shell features, so it runs
  // through the shell verbatim.
  const browserCommand = (options.browser).replace(/%u/g, url);
  await ioHelper.defaults.debug(`Opening documentation ${chalk.green(browserCommand)}`);

  try {
    const { stdout, stderr } = await runUserCommandLine(browserCommand);
    if (stdout) {
      await ioHelper.defaults.debug(stdout);
    }
    if (stderr) {
      await ioHelper.defaults.warn(stderr);
    }
  } catch (err: unknown) {
    const e = err as Error;
    await ioHelper.defaults.debug(`An error occurred when trying to open a browser: ${e.stack || e.message}`);
  }

  return 0;
}
