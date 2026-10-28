/**
 * Returns true if the current process is running in a TTY environment
 * @returns true if the current process is running in a TTY environment
 */
export function isTTY(): boolean {
  return process.stdout.isTTY ?? false;
}
