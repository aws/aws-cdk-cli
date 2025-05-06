import type { IRunnerSource, IPreparedRunnerSource, ITestLibrarySource } from './source';
import { copyDirectoryContents } from '../files';
import { npmMostRecentMatching } from '../npm';

export class RunnerLibraryNpmSource implements IRunnerSource<ITestLibrarySource> {
  public readonly sourceDescription: string;

  constructor(private readonly packageName: string, private readonly range: string) {
    this.sourceDescription = `${this.packageName}@${this.range}`;
  }

  public async runnerPrepare(): Promise<IPreparedRunnerSource<ITestLibrarySource>> {
    const version = await npmMostRecentMatching(this.packageName, this.range);

    return {
      version: version,
      async dispose() {
      },
      serialize: () => {
        return [TestLibraryNpmSource, [this.packageName, version]];
      },
    };
  }
}

export class TestLibraryNpmSource implements ITestLibrarySource {
  constructor(public readonly packageName: string, public readonly version: string) {
  }

  public requestedVersion(): string {
    return this.version;
  }

  public assertJsiiPackagesAvailable(): void {
    // FIXME: This probably shouldn't be here. Always a no-op.
  }

  public async initializeDotnetPackages(currentDir: string): Promise<void> {
    // FIXME: this code has nothing to do with the package source, really, so shouldn't be here.
    if (process.env.CWD_FILES_DIR) {
      await copyDirectoryContents(process.env.CWD_FILES_DIR, currentDir);
    }
  }

  public requestedAlphaVersion(): string {
    const frameworkVersion = this.requestedVersion();
    if (frameworkVersion.includes('-rc.')) {
      // For a pipeline release
      return frameworkVersion.replace(/-rc\.\d+$/, '-alpha.999');
    } else {
      // For a stable release
      return `${frameworkVersion}-alpha.0`;
    }
  }
}
