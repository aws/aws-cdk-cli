import { readFile } from 'fs/promises';
import { resolvePreinstalledPackageJson } from './preinstalled';
import type { IRunnerSource, IPreparedRunnerSource, ITestLibrarySource } from './source';
import { copyDirectoryContents } from '../files';

/**
 * A library dependency that should already be installed via `cli-integ`'s dependencies.
 */
export class RunnerLibraryPreinstalledSource implements IRunnerSource<ITestLibrarySource> {
  public static async preinstalledVersion(packageName: string): Promise<string> {
    const resolvedPjPath = resolvePreinstalledPackageJson(packageName);
    const pj = JSON.parse(await readFile(resolvedPjPath, 'utf-8'));
    return pj.version;
  }

  public static async isPreinstalled(packageName: string) {
    try {
      await RunnerLibraryPreinstalledSource.preinstalledVersion(packageName);
      return true;
    } catch {
      return false;
    }
  }

  public readonly sourceDescription: string;

  constructor(private readonly packageName: string) {
    this.sourceDescription = `${this.packageName} from preinstalled deps`;
  }

  public async runnerPrepare(): Promise<IPreparedRunnerSource<ITestLibrarySource>> {
    const version = await RunnerLibraryPreinstalledSource.preinstalledVersion(this.packageName);

    return {
      version,
      async dispose() {
      },
      serialize: () => {
        return [TestLibraryPreinstalledSource, [this.packageName, version]];
      },
    };
  }
}

export class TestLibraryPreinstalledSource implements ITestLibrarySource {
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

