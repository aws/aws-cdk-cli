import type * as https from 'node:https';
import * as path from 'path';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as semver from 'semver';
import type { IoHelper } from '../api-private';
import { cdkCacheDir, versionNumber } from '../util';
import { formatAsBanner } from './util/console-formatters';
import { fetchNpmVersionInfo } from './util/npm';

const ONE_DAY_IN_SECONDS = 1 * 24 * 60 * 60;

const UPGRADE_DOCUMENTATION_LINKS: Record<number, string> = {
  1: 'https://docs.aws.amazon.com/cdk/v2/guide/migrating-v2.html',
};

export class VersionCheckTTL {
  public static timestampFilePath(): string {
    // Using the same path from account-cache.ts
    return path.join(cdkCacheDir(), 'repo-version-ttl');
  }

  private readonly file: string;

  // File modify times are accurate only to the second
  private readonly ttlSecs: number;

  constructor(file?: string, ttlSecs?: number) {
    this.file = file || VersionCheckTTL.timestampFilePath();
    try {
      fs.mkdirsSync(path.dirname(this.file));
      fs.accessSync(path.dirname(this.file), fs.constants.W_OK);
    } catch {
      throw new ToolkitError('DirectoryNotWritable', `Directory (${path.dirname(this.file)}) is not writable.`);
    }
    this.ttlSecs = ttlSecs || ONE_DAY_IN_SECONDS;
  }

  public async hasExpired(): Promise<boolean> {
    try {
      const lastCheckTime = (await fs.stat(this.file)).mtimeMs;
      const today = new Date().getTime();

      if ((today - lastCheckTime) / 1000 > this.ttlSecs) { // convert ms to sec
        return true;
      }
      return false;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return true;
      } else {
        throw err;
      }
    }
  }

  public async update(latestVersion?: string): Promise<void> {
    if (!latestVersion) {
      latestVersion = '';
    }
    await fs.writeFile(this.file, latestVersion);
  }
}

// Export for unit testing only.
// Don't use directly, use displayVersionMessage() instead.
export async function getVersionMessages(currentVersion: string, cacheFile: VersionCheckTTL, agent?: https.Agent): Promise<string[]> {
  if (!(await cacheFile.hasExpired())) {
    return [];
  }

  const packageInfo = await fetchNpmVersionInfo(currentVersion, agent);
  const latestVersion = packageInfo.latestVersion;
  await cacheFile.update(JSON.stringify(packageInfo));

  const versionMessages: string[] = [];

  // Warn if the version currently in use has been deprecated, even if the
  // latest version is not newer (e.g. an accidentally published version that
  // was deprecated and requires a downgrade).
  if (packageInfo.deprecated) {
    versionMessages.push(chalk.red(packageInfo.deprecated));
  }

  // Only recommend an upgrade if the latest version is strictly newer than the
  // current one. This guards against stale or bogus registry metadata.
  if (semver.gt(latestVersion, currentVersion)) {
    versionMessages.push(`Newer version of CDK is available [${chalk.green(latestVersion)}]`);
    const majorUpgradeMessage = getMajorVersionUpgradeMessage(currentVersion);
    if (majorUpgradeMessage) {
      versionMessages.push(majorUpgradeMessage);
    }
  }

  if (versionMessages.length > 0) {
    versionMessages.push('Upgrade recommended (npm install -g aws-cdk)');
  }

  return versionMessages;
}

function getMajorVersionUpgradeMessage(currentVersion: string): string | void {
  const currentMajorVersion = semver.major(currentVersion);
  if (UPGRADE_DOCUMENTATION_LINKS[currentMajorVersion]) {
    return `Information about upgrading from version ${currentMajorVersion}.x to version ${currentMajorVersion + 1}.x is available here: ${UPGRADE_DOCUMENTATION_LINKS[currentMajorVersion]}`;
  }
}

export function shouldDisplayVersionMessage(): boolean {
  return !!process.stdout.isTTY && !process.env.CDK_DISABLE_VERSION_CHECK;
}

/**
 * Options for {@link displayVersionMessage}
 */
export interface DisplayVersionMessageOptions {
  /**
   * The version of the CLI that is currently running
   *
   * @default - the version of this package
   */
  readonly currentVersion?: string;

  /**
   * The cache used to limit how often the version check runs
   *
   * @default - a TTL cache in the CDK cache directory
   */
  readonly versionCheckCache?: VersionCheckTTL;

  /**
   * The agent used for the network request to the npm registry
   *
   * Use this to set up a proxy connection.
   *
   * @default - the shared global node agent
   */
  readonly agent?: https.Agent;
}

export async function displayVersionMessage(
  ioHelper: IoHelper,
  options: DisplayVersionMessageOptions = {},
): Promise<void> {
  try {
    const currentVersion = options.currentVersion ?? versionNumber();
    const versionMessages = await getVersionMessages(currentVersion, options.versionCheckCache ?? new VersionCheckTTL(), options.agent);
    for (const e of formatAsBanner(versionMessages)) {
      await ioHelper.defaults.info(e);
    }
  } catch (err: any) {
    await ioHelper.defaults.debug(`Could not run version check - ${err.message}`);
  }
}
