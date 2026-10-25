import * as fs from 'fs';
import * as path from 'path';

/**
 * The directory preinstalled packages are resolved from when no install
 * directory is given.
 *
 * Packages are looked up as if they were required from a test suite, so the
 * runner finds the same copies the tests themselves would.
 */
export const PREINSTALLED_SEARCH_PATH = path.resolve(__dirname, '../../tests');

/**
 * Resolve the `package.json` of a package that is resolvable from `PREINSTALLED_SEARCH_PATH`.
 *
 * Uses Node's module resolution, so this performs no npm network calls.
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
 * Read the `package.json` of a package installed into `<installRoot>/node_modules`.
 *
 * `installRoot` is the directory the package was installed into, the way
 * `npm install <package>` run in that directory would.
 *
 * @throws if the package is not installed there.
 */
export function readInstalledPackageJson(installRoot: string, packageName: string): any {
  const packageJsonPath = path.join(installRoot, 'node_modules', packageName, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`${packageName} is not installed in ${installRoot} (expected ${packageJsonPath})`);
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
}
