import * as path from 'path';
import * as fs from 'fs-extra';
import type { IRunnerSource, ITestCliSource, IPreparedRunnerSource } from './source';
import { addToShellPath } from '../shell';

/**
 * Repo source for the CLI
 *
 * Just puts the repo path on the $PATH. The CLI should already be compiled to be executable
 */
export class RunnerCliRepoSource implements IRunnerSource<ITestCliSource> {
  public readonly sourceDescription: string;
  private readonly cliBinPath: string;

  constructor(private readonly packageName: string, public readonly repoRoot: string) {
    this.cliBinPath = path.join(this.repoRoot, 'packages', this.packageName, 'bin');
    this.sourceDescription = this.cliBinPath;
  }

  public async runnerPrepare(): Promise<IPreparedRunnerSource<ITestCliSource>> {
    if (!await fs.pathExists(path.join(this.repoRoot, 'package.json')) || !await fs.pathExists(path.join(this.repoRoot, 'yarn.lock'))) {
      throw new Error(`${this.repoRoot}: does not look like the repository root`);
    }

    const pj = JSON.parse(await fs.readFile(path.join(this.cliBinPath, '..', 'package.json'), 'utf-8'));

    return {
      version: pj.version,
      dispose: () => Promise.resolve(),
      serialize: () => {
        return [TestCliRepoSource, [this.cliBinPath]];
      },
    };
  }
}

export class TestCliRepoSource implements ITestCliSource {
  constructor(private readonly cliPath: string) {
  }

  public async makeCliAvailable() {
    addToShellPath(this.cliPath);
  }

  public requestedVersion() {
    return '*';
  }
}
