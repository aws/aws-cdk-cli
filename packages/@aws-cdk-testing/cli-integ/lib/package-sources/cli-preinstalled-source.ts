import { readFile } from 'fs/promises';
import * as path from 'path';
import { TestCliSource } from './cli-npm-source';
import { findPreinstalledInstallRoot } from './preinstalled';
import type { IRunnerSource, ITestCliSource, IPreparedRunnerSource } from './source';

/**
 * A CLI dependency that should already be installed into a `node_modules` directory
 * reachable from `cli-integ`'s `tests` directory.
 *
 * Only looks at the filesystem, so this performs no npm network calls.
 */
export class RunnerCliPreinstalledSource implements IRunnerSource<ITestCliSource> {
  public readonly sourceDescription: string;

  constructor(private readonly packageName: string) {
    this.sourceDescription = `${this.packageName} from preinstalled deps`;
  }

  public async runnerPrepare(): Promise<IPreparedRunnerSource<ITestCliSource>> {
    const installRoot = findPreinstalledInstallRoot(this.packageName);
    const pj = JSON.parse(await readFile(path.join(installRoot, 'node_modules', this.packageName, 'package.json'), 'utf-8'));
    const version = pj.version;

    return {
      version,
      async dispose() {
      },
      serialize: () => {
        return [TestCliSource, [installRoot, version]];
      },
    };
  }
}
