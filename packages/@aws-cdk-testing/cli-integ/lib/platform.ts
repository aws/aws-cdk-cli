/**
 * Whether the current process is running on Windows.
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}
