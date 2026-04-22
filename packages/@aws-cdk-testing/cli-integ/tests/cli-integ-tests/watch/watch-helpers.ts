import type { ChildProcess } from 'node:child_process';

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
 * Kill a spawned process.
 */
export function safeKillProcess(proc: ChildProcess): void {
  try {
    proc.kill('SIGKILL');
  } catch {
    // process may have already exited
  }
}
