import { readFile } from 'fs/promises';
import * as path from 'path';
import { readInstalledPackageJson, resolvePreinstalledPackageJson } from './preinstalled';
import type { IRunnerSource, IPreparedRunnerSource, ITestLibrarySource } from './source';
import { copyDirectoryContents } from '../files';

/**
 * A library dependency that is already installed.
 *
 * Either it is installed into a given `<installRoot>/node_modules`, in which case
 * tests use that installation instead of installing the library themselves, or it
 * is resolved from `cli-integ`'s own dependencies.
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
  private readonly installRoot?: string;

  constructor(private readonly packageName: string, installRoot?: string) {
    this.installRoot = installRoot ? path.resolve(installRoot) : undefined;
    this.sourceDescription = this.installRoot
      ? `${this.packageName} installed in ${this.installRoot}`
      : `${this.packageName} from preinstalled deps`;
  }

  public async runnerPrepare(): Promise<IPreparedRunnerSource<ITestLibrarySource>> {
    const version = this.installRoot
      ? readInstalledPackageJson(this.installRoot, this.packageName).version
      : await RunnerLibraryPreinstalledSource.preinstalledVersion(this.packageName);

    return {
      version,
      async dispose() {
      },
      serialize: () => {
        return [TestLibraryPreinstalledSource, [this.packageName, version, ...this.installRoot ? [this.installRoot] : []]];
      },
    };
  }
}

export class TestLibraryPreinstalledSource implements ITestLibrarySource {
  constructor(
    public readonly packageName: string,
    private readonly version: string,
    public readonly installRoot?: string,
  ) {
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

