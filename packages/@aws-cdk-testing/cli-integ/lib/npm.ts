// eslint-disable-next-line no-restricted-imports -- cli-integ is a test harness that spawns processes to exercise the CLI as a user would; it is test infrastructure, not shipped runtime.
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as semver from 'semver';
import { shell } from './shell';

const MINIMUM_VERSION = '3.9';

export async function npmMostRecentMatching(packageName: string, range: string) {
  const output = JSON.parse(await shell(['node', require.resolve('npm'), '--silent', 'view', `${packageName}@${range}`, 'version', '--json'], {
    show: 'error',
    captureStderr: false,
  }));

  if (typeof output === 'string') {
    return output;
  }
  if (!Array.isArray(output)) {
    throw new Error(`Expected array from npm, got: ${JSON.stringify(output)}`);
  }
  if (output.length === 0) {
    throw new Error(`Found no package matching ${packageName}@${range}`);
  }

  // Otherwise an array that may or may not be sorted. Sort it then get the top one.
  output.sort((a: string, b: string) => semver.compare(a, b));
  return output[output.length - 1];
}

/**
 * Verify that the CLI binary installed under `installRoot` is actually runnable.
 *
 * `npm install` recording a version (see `npmQueryInstalledVersion`) does not
 * guarantee the package's `bin` landed in `node_modules/.bin` or that it runs.
 * During an npm registry degradation an install can be incomplete: the version
 * is recorded but the `cdk` binary is missing, which only surfaces much later
 * as `cdk: not found` (exit 127) from inside a test's `cdk synth` — pointing
 * investigators at CDK/synth instead of at the install.
 *
 * Invoking `<bin> --version` through the same install root the tests will use
 * turns that downstream failure into a clear, install-time diagnosis.
 *
 * @param binName - the executable to run (e.g. `cdk`)
 * @param installRoot - the directory that contains `node_modules/.bin`
 * @param installSpec - the `<pkg>@<range>` that was installed, for the error message
 */
export async function verifyCliRunnable(binName: string, installRoot: string, installSpec: string) {
  const binPath = path.join(installRoot, 'node_modules', '.bin', binName);
  try {
    await shell([binPath, '--version'], {
      cwd: installRoot,
      show: 'error',
      captureStderr: true,
      outputs: [process.stderr],
    });
  } catch (e) {
    throw new Error(
      `CLI install verification failed: '${binName} --version' did not run after installing ${installSpec}. ` +
      'This usually indicates an incomplete or degraded npm install rather than a CDK defect. ' +
      `(underlying error: ${e})`,
    );
  }
}

export async function npmQueryInstalledVersion(packageName: string, dir: string) {
  const reportStr = await shell(['node', require.resolve('npm'), 'list', '--json', '--depth', '0', packageName], {
    cwd: dir,
    show: 'error',
    captureStderr: false,
    outputs: [process.stderr],
  });
  const report = JSON.parse(reportStr);
  return report.dependencies[packageName].version;
}

/**
 * Use NPM preinstalled on the machine to look up a list of TypeScript versions
 */
export function typescriptVersionsSync(): string[] {
  // Invoke npm through Node: on Windows `npm` is a `.cmd` file, which spawnSync cannot execute directly
  const { stdout } = spawnSync(process.execPath, [require.resolve('npm'), '--silent', 'view', `typescript@>=${MINIMUM_VERSION}`, 'version', '--json'], { encoding: 'utf-8' });

  const versions: string[] = JSON.parse(stdout);
  return Array.from(new Set(versions.map(v => v.split('.').slice(0, 2).join('.'))));
}

/**
 * Use NPM preinstalled on the machine to query publish times of versions
 */
export function typescriptVersionsYoungerThanDaysSync(days: number, versions: string[]): string[] {
  const { stdout } = spawnSync(process.execPath, [require.resolve('npm'), '--silent', 'view', 'typescript', 'time', '--json'], { encoding: 'utf-8' });
  const versionTsMap: Record<string, string> = JSON.parse(stdout);

  const cutoffDate = new Date(Date.now() - (days * 24 * 3600 * 1000));
  const cutoffDateS = cutoffDate.toISOString();

  const recentVersions = Object.entries(versionTsMap)
    .filter(([_, dateS]) => dateS > cutoffDateS)
    .map(([v]) => v);

  // Input versions are of the form 3.9, 5.2, etc.
  // Actual versions are of the form `3.9.15`, `5.3.0-dev.20511311`.
  // Return only 2-digit versions for which there is a non-prerelease version in the set of recentVersions
  // So a 2-digit versions that is followed by `.<digits>` until the end of the string.
  return versions.filter((twoV) => {
    const re = new RegExp(`^${reQuote(twoV)}\\.\\d+$`);
    return recentVersions.some(fullV => fullV.match(re));
  });
}

function reQuote(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
