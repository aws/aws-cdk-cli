import { execFile as _execFile } from 'child_process';
import { promisify } from 'util';
import { ToolkitError } from '@aws-cdk/toolkit-lib';

const execFile = promisify(_execFile);

/* c8 ignore start */
export async function execNpmView(currentVersion: string) {
  try {
    // Run the two npm view calls without a shell (avoids extra shell/socket handles).
    // Provide a timeout and a maxBuffer to ensure the child is killed / doesn't block.
    const opts = { timeout: 3000, maxBuffer: 10 * 1024 * 1024, windowsHide: true };

    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    const [latestResult, currentResult] = await Promise.all([
      execFile('npm', ['view', 'aws-cdk@latest', 'version'], opts),
      execFile('npm', ['view', `aws-cdk@${currentVersion}`, 'name', 'version', 'deprecated', '--json'], opts),
    ]);

    // execFile returns objects with stdout/stderr as strings
    const latestStdout = (latestResult as any).stdout ?? '';
    const latestStderr = (latestResult as any).stderr ?? '';
    const currentStdout = (currentResult as any).stdout ?? '';
    const currentStderr = (currentResult as any).stderr ?? '';

    if (latestStderr && latestStderr.trim().length > 0) {
      throw new ToolkitError(`npm view command for latest version failed: ${latestStderr.trim()}`);
    }
    if (currentStderr && currentStderr.trim().length > 0) {
      throw new ToolkitError(`npm view command for current version failed: ${currentStderr.trim()}`);
    }

    const latestVersion = latestStdout;
    const currentInfo = JSON.parse(currentStdout);

    return {
      latestVersion: latestVersion,
      deprecated: currentInfo.deprecated,
    };
  } catch (err: unknown) {
    throw err;
  }
}
/* c8 ignore stop */
