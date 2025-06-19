import { spawn } from 'child_process';
import { ToolkitError } from '@aws-cdk/toolkit-lib';

/* c8 ignore start */
export async function execNpmView(currentVersion: string) {
  try {
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    const [latestResult, currentResult] = await Promise.all([
      execCommand('npm', ['view', 'aws-cdk@latest', 'version'], { timeout: 3000 }),
      execCommand('npm', ['view', `aws-cdk@${currentVersion}`, 'name', 'version', 'deprecated', '--json'], { timeout: 3000 }),
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
      deprecated: currentInfo.deprecated,
    };
  } catch (err: unknown) {
    throw err;
  }
}

interface ExecResult {
  stdout: string;
  stderr: string;
}

interface ExecOptions {
  timeout?: number;
}

function execCommand(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    
    const proc = spawn(command, args, {
      shell: false,
    });
    
    let timeoutId: NodeJS.Timeout | undefined;
    if (options.timeout) {
      timeoutId = setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${options.timeout}ms: ${command} ${args.join(' ')}`));
      }, options.timeout);
    }
    
    proc.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    proc.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    
    proc.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(err);
    });
    
    proc.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (code === 0) {
        resolve({
          stdout: Buffer.concat(stdout).toString().trim(),
          stderr: Buffer.concat(stderr).toString().trim(),
        });
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`));
      }
    });
  });
}
/* c8 ignore stop */
