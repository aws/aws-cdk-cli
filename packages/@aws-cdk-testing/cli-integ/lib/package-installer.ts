import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import { sleep } from './aws';
import { readInstalledPackageJson } from './package-sources/preinstalled';
import type { ITestLibrarySource } from './package-sources/source';
import { isWindows } from './platform';
import { shell } from './shell';
import { XpMutexPool } from './xpmutex';
import { findYarnPackages } from './yarn';

/**
 * What a package installer needs to know about the test it is installing for.
 */
export interface PackageInstallContext {
  /**
   * The test directory; packages are made available in its `node_modules`.
   */
  readonly integTestDir: string;

  /**
   * Where install output is written.
   */
  readonly output: NodeJS.WritableStream;

  log(s: string): void;
}

/**
 * Makes a set of npm packages available in a test directory.
 */
export interface IPackageInstaller {
  /**
   * Make the given packages, identified by name and requested version, available in
   * `<integTestDir>/node_modules`.
   */
  install(context: PackageInstallContext, packages: Record<string, string>): Promise<void>;
}

/**
 * Pick the installer that matches how the framework was sourced for this run.
 *
 * If the framework is installed in a given directory (`--framework-path`), packages
 * are always reused from that directory and never installed from the registry.
 */
export function packageInstallerFor(library: ITestLibrarySource): IPackageInstaller {
  return library.installRoot
    ? new PreinstalledPackageInstaller(library.installRoot)
    : new NpmPackageInstaller();
}

/**
 * Installs packages from the npm registry.
 *
 * Works by writing the packages to a `package.json` file, and then running NPM7's
 * "install" on it. The use of NPM7 will automatically install required
 * peerDependencies.
 *
 * The install itself is shared: because every test asks for the same handful of
 * packages at the same resolved versions, they are installed once per machine and
 * linked into each test directory. See `sharedPackageSetInstall`.
 *
 * If we're running in REPO mode and we find the package in the set of local
 * packages in the repository, we'll write the directory name to `package.json`
 * so that NPM will create a symlink (this allows running tests against
 * built-but-unpackaged modules, and saves dev cycle time).
 *
 * Be aware you MUST install all the packages you directly depend upon! In the case
 * of a repo/symlinking install, transitive dependencies WILL NOT be installed in the
 * current directory's `node_modules` directory, because they will already have been
 * symlinked from the TARGET directory's `node_modules` directory (which is sufficient
 * for Node's dependency lookup mechanism).
 */
export class NpmPackageInstaller implements IPackageInstaller {
  public async install(context: PackageInstallContext, packages: Record<string, string>): Promise<void> {
    let hasLocalPackages = false;

    if (process.env.REPO_ROOT) {
      const monoRepo = await findYarnPackages(process.env.REPO_ROOT);

      // Replace the install target with the physical location of this package
      for (const key of Object.keys(packages)) {
        if (key in monoRepo) {
          packages[key] = monoRepo[key];
          hasLocalPackages = true;
        }
      }
    }

    writePackageJson(context.integTestDir, packages);

    if (hasLocalPackages) {
      // A local package is referenced by directory, so the package set no longer
      // identifies its own contents: rebuilding changes what is on disk without
      // changing the requested version. Install per test, so that the dev cycle
      // of 'rebuild, rerun the test' keeps working.
      await npmInstallWithRetry(context, context.integTestDir);
      return;
    }

    // Every test installs the same small set of packages, and `aws-cdk-lib` alone is
    // tens of thousands of files, so installing per test is pure duplicated work: it
    // is very slow on Windows (minutes instead of seconds), and on every platform it
    // means many concurrent `npm install` processes, which is a source of ECONNRESET
    // failures. Install each distinct package set once per machine and link it into
    // the test directory instead.
    const sharedNodeModules = await sharedPackageSetInstall(context, packages);
    fs.symlinkSync(
      sharedNodeModules,
      path.join(context.integTestDir, 'node_modules'),
      // Ignored on POSIX. On Windows a 'junction' works for unprivileged users,
      // where a 'dir' symlink needs elevation.
      isWindows() ? 'junction' : 'dir',
    );

    // `npm` writes the lock file next to the `package.json` it installed, which is now
    // the shared directory, so copy it back into the test directory. Constructs that
    // bundle (`NodejsFunction`) find their project root by searching upwards from the
    // app for a lock file, and bundle-mount that directory into Docker; without a lock
    // file here the search escapes the test directory and synth fails.
    fs.copyFileSync(
      path.join(sharedNodeModules, '..', 'package-lock.json'),
      path.join(context.integTestDir, 'package-lock.json'),
    );
  }
}

/**
 * Reuses packages that are already installed in a directory, without touching the registry.
 *
 * Each requested package is taken from `<installRoot>/node_modules` and linked into
 * the test's `node_modules`. Packages are linked to their real location, so packages
 * that depend on each other (such as `aws-cdk-lib` and `constructs`) keep resolving
 * the same single copy, since they are installed side by side.
 *
 * There is no fallback to npm: if any requested package is missing, the install
 * fails and lists every missing package.
 */
export class PreinstalledPackageInstaller implements IPackageInstaller {
  constructor(private readonly installRoot: string) {
  }

  public async install(context: PackageInstallContext, packages: Record<string, string>): Promise<void> {
    const resolved = new Array<{ name: string; requested: string; dir: string; version: string }>();
    const missing = new Array<string>();

    for (const [name, requested] of Object.entries(packages)) {
      let version: string;
      try {
        version = readInstalledPackageJson(this.installRoot, name).version;
      } catch {
        missing.push(name);
        continue;
      }
      resolved.push({ name, requested, dir: fs.realpathSync(path.join(this.installRoot, 'node_modules', name)), version });
    }

    if (missing.length > 0) {
      throw new Error(
        `This test requires packages that are not installed in ${this.installRoot}: ${missing.join(', ')}. ` +
        'With --framework-path, packages are never installed from the registry.',
      );
    }

    writePackageJson(context.integTestDir, packages);

    const nodeModules = path.join(context.integTestDir, 'node_modules');
    for (const pkg of resolved) {
      if (semver.validRange(pkg.requested) && !semver.satisfies(pkg.version, pkg.requested, { includePrerelease: true })) {
        context.log(`Using preinstalled ${pkg.name}@${pkg.version}, which does not satisfy the requested '${pkg.requested}'`);
      }

      const linkPath = path.join(nodeModules, pkg.name);
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      fs.symlinkSync(pkg.dir, linkPath, isWindows() ? 'junction' : 'dir');
    }

    context.log(`Linked preinstalled packages: ${resolved.map(p => `${p.name}@${p.version}`).join(', ')}`);

    // Constructs that bundle (`NodejsFunction`) find their project root by searching
    // upwards from the app for a lock file. Write a minimal one so that search stops
    // at the test directory, as it does after a registry install.
    fs.writeFileSync(path.join(context.integTestDir, 'package-lock.json'), JSON.stringify({
      name: 'cdk-integ-tests',
      version: '0.0.1',
      lockfileVersion: 3,
      requires: true,
      packages: {},
    }, undefined, 2), { encoding: 'utf-8' });
  }
}

function writePackageJson(dir: string, packages: Record<string, string>) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'cdk-integ-tests',
    private: true,
    version: '0.0.1',
    devDependencies: packages,
  }, undefined, 2), { encoding: 'utf-8' });
}

/**
 * Mutex pool guarding the shared installs, created on first use.
 *
 * Constructing a pool starts an `fs.watch`, so don't do it for test runs that
 * never install anything.
 */
let installMutexPool: XpMutexPool | undefined;

/**
 * Install the given package set into a machine-shared directory, once.
 *
 * Concurrent callers (jest workers are separate processes) coordinate through a
 * cross-process mutex: whoever holds it installs, and everyone else waits and then
 * finds the completion marker already there. A worker that dies while installing
 * holds a lock nobody would ever release, so `XpMutex` reclaims it once the owning
 * pid is gone.
 *
 * The shared directory is keyed on the requested package set. Those versions are
 * always fully resolved by the time they get here (see `requestedVersion()` on the
 * library sources), so the key identifies the contents and the directory can be
 * reused across runs on the same machine.
 *
 * @returns the path of the installed `node_modules` directory.
 */
async function sharedPackageSetInstall(context: PackageInstallContext, packages: Record<string, string>): Promise<string> {
  const hash = crypto.createHash('sha256').update(JSON.stringify(packages)).digest('hex').slice(0, 16);
  const sharedDir = path.join(os.tmpdir(), `cdk-integ-shared-${hash}`);
  const nodeModules = path.join(sharedDir, 'node_modules');

  // Only ever written after a successful install, so a half-installed directory
  // (from a worker that was killed) is never handed out.
  const completeMarker = path.join(sharedDir, '.install-complete');

  if (fs.existsSync(completeMarker)) {
    return nodeModules;
  }

  if (!installMutexPool) {
    installMutexPool = XpMutexPool.fromName('cdk-integ-shared-install');
  }
  const lock = await installMutexPool.mutex(hash).acquire();
  try {
    if (fs.existsSync(completeMarker)) {
      return nodeModules;
    }

    context.log(`Installing shared package set into '${sharedDir}'`);
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.copyFileSync(path.join(context.integTestDir, 'package.json'), path.join(sharedDir, 'package.json'));
    await npmInstallWithRetry(context, sharedDir);
    fs.writeFileSync(completeMarker, '');
    return nodeModules;
  } finally {
    await lock.release();
  }
}

async function npmInstallWithRetry(context: PackageInstallContext, cwd: string) {
  // we often ECONNRESET from NPM so lets retry. this might be because of high concurrency
  // which overwhelmes system resources.
  const timeoutMinutes = 10;
  const timeoutDate = new Date(Date.now() + timeoutMinutes * 60 * 1000);
  const retryAfterSeconds = 30;

  while (true) {
    try {
      // Now install that `package.json` using NPM7
      await shell(['node', require.resolve('npm'), 'install'], {
        cwd,
        outputs: [context.output],
      });
      break;
    } catch (e: any) {
      if (Date.now() < timeoutDate.getTime() && context.output.toString().includes('ECONNRESET' )) {
        context.log(`npm install failed due to ECONNRESET. Retrying in ${retryAfterSeconds} seconds...`);
        await sleep(retryAfterSeconds * 1000);
        continue;
      }
      throw e;
    }
  }
}
