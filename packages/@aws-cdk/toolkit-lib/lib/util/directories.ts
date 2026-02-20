import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { ToolkitError } from '../toolkit/toolkit-error';

/**
 * Return a location that will be used as the CDK home directory.
 * Currently the only thing that is placed here is the cache.
 *
 * First try to use the users home directory (i.e. /home/someuser/),
 * but if that directory does not exist for some reason create a tmp directory.
 *
 * Typically it wouldn't make sense to create a one time use tmp directory for
 * the purpose of creating a cache, but since this only applies to users that do
 * not have a home directory (some CI systems?) this should be fine.
 */
export function cdkHomeDir() {
  const tmpDir = fs.realpathSync(os.tmpdir());
  let home;
  try {
    let userInfoHome: string | undefined = os.userInfo().homedir;
    // Node returns this if the user doesn't have a home directory
    /* c8 ignore start */ // will not happen in normal setups
    if (userInfoHome == '/var/empty') {
      userInfoHome = undefined;
    }
    /* c8 ignore stop */
    home = path.join((userInfoHome ?? os.homedir()).trim(), '.cdk');
  } catch {
  }
  return process.env.CDK_HOME
    ? path.resolve(process.env.CDK_HOME)
    : home || fs.mkdtempSync(path.join(tmpDir, '.cdk')).trim();
}

export function cdkCacheDir() {
  return path.join(cdkHomeDir(), 'cache');
}

/**
 * From the start location, find the directory that contains the bundled package's package.json
 *
 * You must assume the caller of this function will be bundled and the package root dir
 * is not going to be the same as the package the caller currently lives in.
 */
export function bundledPackageRootDir(start: string): string;
export function bundledPackageRootDir(start: string, fail: true): string;
export function bundledPackageRootDir(start: string, fail: false): string | undefined;
export function bundledPackageRootDir(start: string, fail?: boolean) {
  function _rootDir(dirname: string): string | undefined {
    const manifestPath = path.join(dirname, 'package.json');
    if (fs.existsSync(manifestPath)) {
      return dirname;
    }
    if (path.dirname(dirname) === dirname) {
      if (fail ?? true) {
        throw new ToolkitError('Unable to find package manifest');
      }
      return undefined;
    }
    return _rootDir(path.dirname(dirname));
  }

  return _rootDir(start);
}

/**
 * Recursively lists all files in a directory up to the specified depth.
 *
 * @param dirName - The directory path to list files from
 * @param depth - Maximum depth to traverse (1 = current directory only, 2 = one level deep, etc.)
 * @returns Array of file names (not full paths) found within the depth limit
 */
export async function listFiles(dirName: string, depth: number, excludeDirs?: string[]): Promise<string[]> {
  const ret = await fsExtra.readdir(dirName, { encoding: 'utf-8', withFileTypes: true });

  // unlikely to be unbound, it's a file system
  // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
  return (await Promise.all(ret.map(async (f) => {
    if (f.isDirectory()) {
      if (depth <= 1 || excludeDirs?.includes(f.name)) {
        return [];
      }
      return listFiles(path.join(dirName, f.name), depth - 1, excludeDirs);
    } else {
      return [f.name];
    }
  }))).flatMap(xs => xs);
}
