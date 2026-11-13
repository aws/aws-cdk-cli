import * as fs from 'fs';
import * as path from 'path';

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
