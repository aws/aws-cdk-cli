import * as path from 'path';

/**
 * The directory preinstalled packages are resolved from.
 *
 * Packages are looked up as if they were required from a test suite, so the
 * runner finds the same copies the tests themselves would.
 */
export const PREINSTALLED_SEARCH_PATH = path.resolve(__dirname, '../../tests');

/**
 * Resolve the `package.json` of a preinstalled package.
 *
 * Uses Node's module resolution starting at `PREINSTALLED_SEARCH_PATH`, so this
 * performs no npm network calls.
 *
 * @throws if the package cannot be resolved.
 */
export function resolvePreinstalledPackageJson(packageName: string): string {
  try {
    return require.resolve(`${packageName}/package.json`, {
      paths: [PREINSTALLED_SEARCH_PATH],
    });
  } catch (e) {
    throw new Error(`${packageName} not found preinstalled (searching from ${PREINSTALLED_SEARCH_PATH}): ${e}`);
  }
}

/**
 * Whether the given package can be resolved from the preinstalled location.
 */
export function isPackagePreinstalled(packageName: string): boolean {
  try {
    resolvePreinstalledPackageJson(packageName);
    return true;
  } catch {
    return false;
  }
}
