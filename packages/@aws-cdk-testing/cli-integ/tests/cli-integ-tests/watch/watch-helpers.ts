import * as child_process from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { isWindows } from '../../../lib';

const DEFAULT_POLL_TIMEOUT = 120_000; // 2 minutes

/**
 * Poll a condition until we see it, with a timeout.
 */
async function poll(condition: () => boolean, timeoutMs = DEFAULT_POLL_TIMEOUT): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() >= deadline) return reject(new Error(`poll timed out after ${timeoutMs}ms`));
      setTimeout(check, 1000);
    };
    check();
  });
}

/**
 * Wait for a specific string to appear in the output.
 */
export async function waitForOutput(getOutput: () => string, searchString: string): Promise<void> {
  await poll(() => getOutput().includes(searchString));
  expect(getOutput()).toContain(searchString);
}

/**
 * Wait for a condition to become true.
 */
export async function waitForCondition(condition: () => boolean): Promise<void> {
  await poll(condition);
  expect(condition()).toBe(true);
}

/**
 * Spawn a long-running `cdk watch` process.
 *
 * On Windows the CLI is an npm .cmd shim, which `spawn` can only start
 * through a shell ('spawn cdk ENOENT' otherwise).
 */
export function spawnWatch(args: string[], options: SpawnOptions): ChildProcess {
  return child_process.spawn('cdk', args, {
    stdio: 'pipe',
    shell: isWindows(),
    ...options,
  });
}

/**
 * Kill a spawned process.
 */
export function safeKillProcess(proc: ChildProcess): void {
  try {
    if (isWindows() && proc.pid !== undefined) {
      // Kill the whole tree: the process was spawned through a shell,
      // so proc.pid is the shell and 'cdk watch' is its child.
      child_process.spawnSync('taskkill', ['/pid', proc.pid.toString(), '/T', '/F']);
    } else {
      proc.kill('SIGKILL');
    }
  } catch {
    // process may have already exited
  }
}
