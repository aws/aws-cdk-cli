/**
 * Returns true if the current process is running in a CI environment
 * @returns true if the current process is running in a CI environment
 */
export function isCI(): boolean {
  return process.env.CI !== undefined && process.env.CI !== 'false' && process.env.CI !== '0';
}

/**
 * Returns true if the current process is running in a TTY environment
 * @returns true if the current process is running in a TTY environment
 */
export function isTTY(): boolean {
  return process.stdout.isTTY ?? false;
}
