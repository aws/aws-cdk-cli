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
  private readonly cliPath: string;

  constructor(private readonly repoRoot: string) {
    this.cliPath = path.join(this.repoRoot, 'packages', 'aws-cdk', 'bin');
    this.sourceDescription = this.cliPath;
  }

  public async runnerPrepare(): Promise<IPreparedRunnerSource<ITestCliSource>> {
    if (!await fs.pathExists(path.join(this.repoRoot, 'package.json')) || !await fs.pathExists(path.join(this.repoRoot, 'yarn.lock'))) {
      throw new Error(`${this.repoRoot}: does not look like the repository root`);
    }

    return {
      version: '*',
      dispose: () => Promise.resolve(),
      serialize: () => {
        return [TestCliRepoSource, [this.cliPath]];
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
