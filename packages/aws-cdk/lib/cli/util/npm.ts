import { exec as _exec } from 'child_process';
import { promisify } from 'util';
import { ToolkitError } from '../../toolkit/error';

const exec = promisify(_exec);

export async function execNpmView(currentVersion: string) {
  const { stdout, stderr } = await exec(`npm view aws-cdk@${currentVersion} name version deprecated --json`, { timeout: 3000 });
  if (stderr && stderr.trim().length > 0) {
    throw new ToolkitError(`npm view command failed: ${stderr.trim()}`);
  }
  return JSON.parse(stdout);
}
