/**
 * Shared helper functions for watch integration tests.
 */

/**
 * Poll a condition until we see it.
 */
async function poll(condition: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (condition()) return resolve();
      setTimeout(check, 1000);
    };
    check();
  });
}

/**
 * Wait for a specific string to appear in the output.
 */
export async function waitForOutput(getOutput: () => string, searchString: string): Promise<void> {
  return poll(() => getOutput().includes(searchString));
}

/**
 * Wait for a condition to become true.
 */
export async function waitForCondition(condition: () => boolean): Promise<void> {
  return poll(condition);
}
