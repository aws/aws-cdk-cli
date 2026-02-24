/**
 * Shared helper functions for watch integration tests.
 */

/**
 * Poll a condition until it returns true or timeout is reached.
 */
async function pollUntil(condition: () => boolean, timeoutMs: number, errorMessage: string): Promise<void> {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - startTime > timeoutMs) {
        return reject(new Error(errorMessage));
      }
      setTimeout(check, 1000);
    };
    check();
  });
}

/**
 * Wait for a specific string to appear in the output.
 */
export async function waitForOutput(getOutput: () => string, searchString: string, timeoutMs: number): Promise<void> {
  return pollUntil(
    () => getOutput().includes(searchString),
    timeoutMs,
    `Timeout waiting for: "${searchString}"`,
  );
}

/**
 * Wait for a condition to become true.
 */
export async function waitForCondition(condition: () => boolean, timeoutMs: number, description: string): Promise<void> {
  return pollUntil(condition, timeoutMs, `Timeout waiting for ${description}`);
}
