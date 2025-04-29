import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import type { IRunnerSource, ITestCliSource, IPreparedRunnerSource } from './source';
import { addToShellPath, rimraf, shell } from '../shell';

export class RunnerCliNpmSource implements IRunnerSource<ITestCliSource> {
  public readonly sourceDescription: string;

  constructor(private readonly range: string) {
    this.sourceDescription = `${this.range} (npm)`;
  }

  public async runnerPrepare(): Promise<IPreparedRunnerSource<ITestCliSource>> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpcdk'));
    fs.mkdirSync(tempDir, { recursive: true });

    await shell(['node', require.resolve('npm'), 'install', `aws-cdk@${this.range}`], {
      cwd: tempDir,
    });

    const reportStr = await shell(['node', require.resolve('npm'), 'list', '--json', '--depth', '0', 'aws-cdk'], {
      cwd: tempDir,
      show: 'error',
    });
    const report = JSON.parse(reportStr);
    const installedVersion = report.dependencies['aws-cdk'].version;

    return {
      version: installedVersion,
      async dispose() {
        rimraf(tempDir);
      },
      serialize: () => {
        return [TestCliNpmSource, [tempDir, this.range]];
      },
    };
  }
}

export class TestCliNpmSource implements ITestCliSource {
  constructor(private readonly installRoot: string, private readonly range: string) {
  }

  public async makeCliAvailable() {
    addToShellPath(path.join(this.installRoot, 'node_modules', '.bin'));
  }

  public requestedVersion() {
    return this.range;
  }
}

