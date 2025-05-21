import { spawnSync } from 'child_process';
import * as semver from 'semver';
import { shell } from './shell';

const MINIMUM_VERSION = '3.9';

export async function npmMostRecentMatching(packageName: string, range: string) {
  const output = JSON.parse(await shell(['node', require.resolve('npm'), '--silent', 'view', `${packageName}@${range}`, 'version', '--json'], {
    show: 'error',
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
  const { stdout } = spawnSync('npm', ['--silent', 'view', `typescript@>=${MINIMUM_VERSION}`, 'version', '--json'], { encoding: 'utf-8' });

  const versions: string[] = JSON.parse(stdout);
  return Array.from(new Set(versions.map(v => v.split('.').slice(0, 2).join('.'))));
}

/**
 * Use NPM preinstalled on the machine to query publish times of versions
 */
export function typescriptVersionsYoungerThanDaysSync(days: number, versions: string[]): string[] {
  const { stdout } = spawnSync('npm', ['--silent', 'view', 'typescript', 'time', '--json'], { encoding: 'utf-8' });
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
