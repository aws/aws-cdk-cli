import { run } from '@aws-cdk/private-tools/lib/subprocess';
import { ToolkitError } from '@aws-cdk/toolkit-lib';

/* c8 ignore start */
export async function execNpmView(currentVersion: string) {
  // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
  const [latestResult, currentResult] = await Promise.all([
    run(['npm', 'view', 'aws-cdk@latest', 'version'], { timeoutMs: 3000 }),
    run(['npm', 'view', `aws-cdk@${currentVersion}`, 'name', 'version', 'deprecated', '--json'], { timeoutMs: 3000 }),
  ]);

  if (latestResult.stderr && latestResult.stderr.trim().length > 0) {
    throw new ToolkitError('NpmViewLatestFailed', `npm view command for latest version failed: ${latestResult.stderr.trim()}`);
  }
  if (currentResult.stderr && currentResult.stderr.trim().length > 0) {
    throw new ToolkitError('NpmViewCurrentFailed', `npm view command for current version failed: ${currentResult.stderr.trim()}`);
  }

  const latestVersion = latestResult.stdout.trim();
  const currentInfo = JSON.parse(currentResult.stdout);

  return {
    latestVersion: latestVersion,
    deprecated: currentInfo.deprecated,
  };
}
/* c8 ignore stop */
