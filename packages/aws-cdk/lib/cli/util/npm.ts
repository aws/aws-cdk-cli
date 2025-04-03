import { exec as _exec } from 'child_process';
import { promisify } from 'util';
import * as semver from 'semver';
import { ToolkitError } from '../../api';
import { debug } from '../../logging';

const exec = promisify(_exec);

/* c8 ignore start */
/* not called during unit tests */
export async function getLatestVersionFromNpm(): Promise<string> {
  const { stdout, stderr } = await exec('npm view aws-cdk version', { timeout: 3000 });
  if (stderr && stderr.trim().length > 0) {
    debug(`The 'npm view' command generated an error stream with content [${stderr.trim()}]`);
  }
  const latestVersion = stdout.trim();
  if (!semver.valid(latestVersion)) {
    throw new ToolkitError(`npm returned an invalid semver ${latestVersion}`);
  }

  return latestVersion;
}
/* c8 ignore stop */
