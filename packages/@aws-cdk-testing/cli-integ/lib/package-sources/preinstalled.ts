import * as fs from 'fs';
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
 * Find the directory whose `node_modules` holds the given preinstalled package.
 *
 * Searches upwards from `PREINSTALLED_SEARCH_PATH` the same way Node does, but
 * without following symlinks, so the result is where the package is installed
 * (and where its `node_modules/.bin` entries are) even if the package itself is
 * a symlink to somewhere else.
 *
 * @throws if the package cannot be found.
 */
export function findPreinstalledInstallRoot(packageName: string): string {
  let dir = PREINSTALLED_SEARCH_PATH;
  while (true) {
    if (fs.existsSync(path.join(dir, 'node_modules', packageName, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`${packageName} not found preinstalled (searching from ${PREINSTALLED_SEARCH_PATH})`);
    }
    dir = parent;
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
