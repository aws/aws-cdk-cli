import * as child_process from 'child_process';
import { CommandLine, ToolkitError } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import { debug } from '../../logging';

/**
 * OS helpers
 *
 * Shell function which both prints to stdout and collects the output into a
 * string.
 */
export async function shell(command: string[]): Promise<string> {
  const commandLine = new CommandLine(command).toStringGrouped();
  debug(`Executing ${chalk.blue(commandLine)}`);
  const child = child_process.spawn(command[0], command.slice(1), {
    shell: false,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  return new Promise<string>((resolve, reject) => {
    const stdout = new Array<any>();

    // Both write to stdout and collect
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      stdout.push(chunk);
    });

    child.once('error', reject);

    child.once('exit', code => {
      if (code === 0) {
        resolve(Buffer.from(stdout).toString('utf-8'));
      } else {
        reject(new ToolkitError(`${commandLine} exited with error code ${code}`));
      }
    });
  });
}
