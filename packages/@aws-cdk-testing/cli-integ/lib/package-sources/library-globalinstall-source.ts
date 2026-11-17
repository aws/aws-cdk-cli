import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readInstalledPackageJson } from './preinstalled';
import type { IRunnerSource, IPreparedRunnerSource, ITestLibrarySource } from './source';
import { copyDirectoryContents } from '../files';
import { npmQueryInstalledVersion } from '../npm';
import { shell } from '../shell';

/**
 * A library dependency that cli-integ links into its own `node_modules`.
 *
 * By default the requested version is installed from the registry first. Use
 * `fromInstallRoot` to link a package that is already installed instead.
 */
export class RunnerLibraryGlobalInstallSource implements IRunnerSource<ITestLibrarySource> {
  /**
   * Link a package that is already installed into `<installRoot>/node_modules`, without installing it.
   */
  public static fromInstallRoot(packageName: string, installRoot: string): RunnerLibraryGlobalInstallSource {
    return new RunnerLibraryGlobalInstallSource(packageName, undefined, path.resolve(installRoot));
  }

  public readonly sourceDescription: string;

  /**
   * @param range - the version range to install from the registry, `latest` if not given. Not used when `installRoot` is given.
   */
  constructor(private readonly packageName: string, private readonly range: string = 'latest', private readonly installRoot?: string) {
    this.sourceDescription = installRoot
      ? `${this.packageName} installed in ${installRoot}`
      : `${this.packageName}@${this.range}`;
  }

  public async runnerPrepare(): Promise<IPreparedRunnerSource<ITestLibrarySource>> {
    const installRoot = this.installRoot ?? await this.installFromRegistry();
    const version = this.installRoot
      ? readInstalledPackageJson(installRoot, this.packageName).version
      : await npmQueryInstalledVersion(this.packageName, installRoot);

    const symlinkPath = path.join(__dirname, '..', '..', 'node_modules', this.packageName);
    await fs.mkdir(path.dirname(symlinkPath), { recursive: true });
    await fs.symlink(path.join(installRoot, 'node_modules', this.packageName), symlinkPath, 'junction');

    return {
      version,
      async dispose() {
        // Remove the symlink again
        await fs.unlink(symlinkPath);
      },
      serialize: () => {
        return [TestLibraryGlobalInstallSource, [this.packageName, version]];
      },
    };
  }

  /**
   * Install the requested package into a new tempdir.
   *
   * @returns the tempdir
   */
  private async installFromRegistry(): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmpcdk'));
    await fs.mkdir(tempDir, { recursive: true });

    await shell(['node', require.resolve('npm'), 'install', `${this.packageName}@${this.range}`], {
      cwd: tempDir,
      show: 'error',
      outputs: [process.stderr],
    });

    return tempDir;
  }
}

export class TestLibraryGlobalInstallSource implements ITestLibrarySource {
  constructor(public readonly packageName: string, private readonly version: string) {
  }

  public requestedVersion(): string {
    return this.version;
  }

  public assertJsiiPackagesAvailable(): void {
    // FIXME: Always a no-op.
  }

  public async initializeDotnetPackages(currentDir: string): Promise<void> {
    // FIXME: this code has nothing to do with the package source, really, so shouldn't be here.
    if (process.env.CWD_FILES_DIR) {
      await copyDirectoryContents(process.env.CWD_FILES_DIR, currentDir);
    }
  }

  public requestedAlphaVersion(): string {
    return this.version;
  }
}

