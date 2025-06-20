import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as fs from 'fs-extra';

const execAsync = promisify(exec);

/**
 * Clone a GitHub repository to a temporary directory
 *
 * @param githubUrl - The GitHub repository URL
 * @returns The path to the cloned repository
 */
export async function cloneGitHubRepository(githubUrl: string): Promise<string> {
  // Create a temporary directory
  const tempDir = path.join(os.tmpdir(), `cdk-template-${Date.now()}`);
  await fs.mkdirp(tempDir);

  try {
    // Clone the repository
    await execAsync(`git clone --depth 1 ${githubUrl} ${tempDir}`);
    return tempDir;
  } catch (e) {
    // Clean up on error
    await fs.remove(tempDir).catch(() => {
    });
    throw e;
  }
}
