import { readFile } from 'fs/promises';
import * as path from 'path';
import { resolvePreinstalledPackageJson } from './preinstalled';
import type { IRunnerSource, ITestCliSource, IPreparedRunnerSource } from './source';
import { addToShellPath } from '../shell';

/**
 * A CLI dependency that should already be installed, either into `cli-integ`'s own
 * `node_modules`, or globally available on `$PATH`.
 *
 * Resolves the package with `require.resolve`, so this performs no npm network calls.
 */
export class RunnerCliPreinstalledSource implements IRunnerSource<ITestCliSource> {
  public readonly sourceDescription: string;

  constructor(private readonly packageName: string) {
    this.sourceDescription = `${this.packageName} from preinstalled deps`;
  }

  public async runnerPrepare(): Promise<IPreparedRunnerSource<ITestCliSource>> {
    const resolvedPjPath = resolvePreinstalledPackageJson(this.packageName);
    const pj = JSON.parse(await readFile(resolvedPjPath, 'utf-8'));
    const version = pj.version;

    // Walk up from the resolved package.json to the `node_modules` directory it lives directly under,
    // so we can add `<node_modules>/.bin` to the $PATH (same bin layout as a regular npm install).
    const packageDir = path.dirname(resolvedPjPath);
    const nodeModulesDir = path.resolve(packageDir, ...this.packageName.startsWith('@') ? ['..', '..'] : ['..']);
    const binDir = path.join(nodeModulesDir, '.bin');

    return {
      version,
      async dispose() {
      },
      serialize: () => {
        return [TestCliPreinstalledSource, [binDir, version]];
      },
    };
  }
}

export class TestCliPreinstalledSource implements ITestCliSource {
  constructor(private readonly binDir: string, private readonly version: string) {
  }

  public async makeCliAvailable() {
    addToShellPath(path.resolve(this.binDir));
  }

  public requestedVersion() {
    return this.version;
  }
}
