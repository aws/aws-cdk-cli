import * as fs from 'fs';
import * as path from 'path';
import { TestCliSource } from './cli-npm-source';
import { readInstalledPackageJson } from './preinstalled';
import type { IRunnerSource, ITestCliSource, IPreparedRunnerSource } from './source';

/**
 * A CLI that is already installed into `<installRoot>/node_modules`.
 *
 * Only looks at the filesystem, so this performs no npm network calls.
 */
export class RunnerCliPreinstalledSource implements IRunnerSource<ITestCliSource> {
  public readonly sourceDescription: string;
  private readonly installRoot: string;

  constructor(private readonly packageName: string, installRoot: string) {
    this.installRoot = path.resolve(installRoot);
    this.sourceDescription = `${this.packageName} installed in ${this.installRoot}`;
  }

  public async runnerPrepare(): Promise<IPreparedRunnerSource<ITestCliSource>> {
    const pj = readInstalledPackageJson(this.installRoot, this.packageName);
    const version = pj.version;

    // Tests run the CLI from `<installRoot>/node_modules/.bin`. If an executable is
    // missing there, a different copy further down the $PATH would be used instead.
    const binDir = path.join(this.installRoot, 'node_modules', '.bin');
    // A string `bin` is named after the package, without its scope (`@scope/foo` becomes `foo`)
    const binNames = typeof pj.bin === 'string' ? [pj.name.replace(/^@[^/]+\//, '')] : Object.keys(pj.bin ?? {});
    const missingBins = binNames.filter(name => !fs.existsSync(path.join(binDir, name)));
    if (missingBins.length > 0) {
      throw new Error(`${this.packageName} is installed in ${this.installRoot}, but ${binDir} is missing its executables: ${missingBins.join(', ')}`);
    }

    return {
      version,
      async dispose() {
      },
      serialize: () => {
        return [TestCliSource, [this.installRoot, version]];
      },
    };
  }
}
