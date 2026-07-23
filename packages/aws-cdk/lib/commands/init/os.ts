import { run, renderForDisplay, SubprocessError } from '@aws-cdk/private-tools/lib/subprocess';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import chalk from 'chalk';
import type { IoHelper } from '../../api-private';

/**
 * OS helpers
 *
 * Executes the given command (argv array, never through a shell) while both
 * printing its stdout in real-time and collecting it into the returned
 * string. stderr goes straight to the terminal.
 */
export async function shell(ioHelper: IoHelper, command: string[]): Promise<string> {
  await ioHelper.defaults.debug(`Executing ${chalk.blue(renderForDisplay(command))}`);

  try {
    const result = await run(command, {
      onOutput: (stream, data) => {
        (stream === 'stdout' ? process.stdout : process.stderr).write(data);
      },
    });
    return result.stdout;
  } catch (e: any) {
    if (e instanceof SubprocessError && e.exitCode != null) {
      throw new ToolkitError('CommandFailed', e.message);
    }
    throw e;
  }
}
