import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import type { IRunnerSource, ITestCliSource, IPreparedRunnerSource } from './source';
import { npmInstallWithRetry, npmQueryInstalledVersion, verifyCliRunnable } from '../npm';
import { addToShellPath, rimraf } from '../shell';

/**
 * The executable that a given CLI package installs into `node_modules/.bin`.
 *
 * npm names the bin after the `bin` key in the package's `package.json`, which
 * does not always equal the package name (e.g. `aws-cdk` installs `cdk`).
 */
const CLI_BIN_NAMES: Record<string, string> = {
  'aws-cdk': 'cdk',
  'cdk-assets': 'cdk-assets',
};

function cliBinName(packageName: string): string {
  return CLI_BIN_NAMES[packageName] ?? packageName;
}

export class RunnerCliNpmSource implements IRunnerSource<ITestCliSource> {
  public readonly sourceDescription: string;

  constructor(private readonly packageName: string, private readonly range: string) {
    this.sourceDescription = `${this.range} (npm)`;
  }

  public async runnerPrepare(): Promise<IPreparedRunnerSource<ITestCliSource>> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpcdk'));
    fs.mkdirSync(tempDir, { recursive: true });

    const installSpec = `${this.packageName}@${this.range}`;

    // Bounded retry: npm registry degradations are transient, so a brief blip
    // shouldn't cut a canary ticket.
    await npmInstallWithRetry(installSpec, tempDir);

    const installedVersion = await npmQueryInstalledVersion(this.packageName, tempDir);

    // Fail fast, with an npm-attributable message, if the bin didn't land or
    // isn't runnable. Recording a version does not prove the CLI is usable;
    // an incomplete install otherwise surfaces much later as `cdk: not found`
    // (exit 127) from inside a test's `cdk synth`, blaming the wrong component.
    await verifyCliRunnable(cliBinName(this.packageName), tempDir, installSpec);

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

