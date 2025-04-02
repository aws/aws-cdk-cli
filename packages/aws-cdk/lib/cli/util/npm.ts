import { exec as _exec } from 'child_process';
import { promisify } from 'util';
import { ToolkitError } from '../../../../@aws-cdk/tmp-toolkit-helpers/src/api';

const exec = promisify(_exec);

export async function execNpmView(currentVersion: string) {
  try {
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    const [latestResult, currentResult] = await Promise.all([
      exec('npm view aws-cdk@latest version', { timeout: 3000 }),
      exec(`npm view aws-cdk@${currentVersion} name version deprecated --json`, { timeout: 3000 })
    ]);
    
    if (latestResult.stderr && latestResult.stderr.trim().length > 0) {
      throw new ToolkitError(`npm view command for latest version failed: ${latestResult.stderr.trim()}`);
    }
    if (currentResult.stderr && currentResult.stderr.trim().length > 0) {
      throw new ToolkitError(`npm view command for current version failed: ${currentResult.stderr.trim()}`);
    }
    
    const latestVersion = latestResult.stdout;
    const currentInfo = JSON.parse(currentResult.stdout);
      
    return {
      latestVersion: latestVersion,
      deprecated: currentInfo.deprecated
    };
  } catch (err: unknown) {
    throw err;
  }
}
