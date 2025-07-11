import * as childProcess from 'child_process';
import { promisify } from 'node:util';
import * as chalk from 'chalk';
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
  const browserCommand = (options.browser).replace(/%u/g, url);
  await ioHelper.defaults.debug(`Opening documentation ${chalk.green(browserCommand)}`);

  const exec = promisify(childProcess.exec);

  try {
    const { stdout, stderr } = await exec(browserCommand);
    if (stdout) {
      await ioHelper.defaults.debug(stdout);
    }
    if (stderr) {
      await ioHelper.defaults.warn(stderr);
    }
  } catch (err: unknown) {
    const e = err as childProcess.ExecException;
    await ioHelper.defaults.debug(`An error occurred when trying to open a browser: ${e.stack || e.message}`);
  }

  return 0;
}
