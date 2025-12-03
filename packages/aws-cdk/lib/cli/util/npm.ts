import { execSync } from 'child_process';
import { ToolkitError } from '@aws-cdk/toolkit-lib';

/* c8 ignore start */
export async function execNpmView(currentVersion: string) {
  try {
    const latestResult = execSync('npm view aws-cdk@latest version', { timeout: 3000 }).toString();
    const currentResult = execSync(`npm view aws-cdk@${currentVersion} name version deprecated --json`, { timeout: 3000 }).toString();

    if (latestResult && latestResult.trim().length > 0) {
      throw new ToolkitError(`npm view command for latest version failed: ${latestResult.trim()}`);
    }
    if (currentResult && currentResult.trim().length > 0) {
      throw new ToolkitError(`npm view command for current version failed: ${currentResult.trim()}`);
    }

    const latestVersion = latestResult;
    const currentInfo = JSON.parse(currentResult);

    return {
      latestVersion: latestVersion,
      deprecated: currentInfo.deprecated,
    };
  } catch (err: unknown) {
    throw err;
  }
}
/* c8 ignore stop */
