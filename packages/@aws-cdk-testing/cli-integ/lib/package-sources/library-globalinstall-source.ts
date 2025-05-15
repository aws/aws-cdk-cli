import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IRunnerSource, IPreparedRunnerSource, ITestLibrarySource } from './source';
import { copyDirectoryContents } from '../files';
import { npmQueryInstalledVersion } from '../npm';
import { shell } from '../shell';

/**
 * A library dependency that cli-integ installs into its own `node_modules`.
 */
export class RunnerLibraryGlobalInstallSource implements IRunnerSource<ITestLibrarySource> {
  public readonly sourceDescription: string;

  constructor(private readonly packageName: string, private readonly range: string) {
    this.sourceDescription = `${this.packageName}@${this.range}`;
  }

  public async runnerPrepare(): Promise<IPreparedRunnerSource<ITestLibrarySource>> {
    // Create a tempdir where we install the requested package, then symlink into our `node_modules`
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmpcdk'));
    await fs.mkdir(tempDir, { recursive: true });

    await shell(['node', require.resolve('npm'), 'install', `${this.packageName}@${this.range}`], {
      cwd: tempDir,
      show: 'error',
    });

    const symlinkPath = path.join(__dirname, '..', '..', 'node_modules', this.packageName);
    await fs.mkdir(path.dirname(symlinkPath), { recursive: true });
    await fs.symlink(path.join(tempDir, 'node_modules', this.packageName), symlinkPath, 'junction');

    const version = await npmQueryInstalledVersion(this.packageName, tempDir);

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

