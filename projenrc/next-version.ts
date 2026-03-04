import { promises as fs } from 'fs';
import * as semver from 'semver';

/**
 * Command for versioning packages
 *
 * If the TESTING_CANDIDATE environment variable is set, do a nominal bump
 * of the version and append `-test.0`.
 */
async function main() {
  const args = process.argv.slice(2);

  // This is the current version
  const currentVersion = process.env.VERSION ?? '';

  // This is the proposed bump type
  const suggestedBump: BumpType | undefined = process.env.SUGGESTED_BUMP as any;
  if (!suggestedBump) {
    throw new Error('SUGGESTED_BUMP not set');
  }

  let bump: BumpType | string = suggestedBump;

  for (const arg of process.argv.slice(2)) {
    const [cmd, value] = arg.split(':');

    switch (cmd) {
      case 'neverMajor':
        // neverMajor should not come after something that sets the bump to
        // something absolute.
        if (!isBumpType(bump)) {
          throw new Error(`Not a relative bump type: ${bump}`);
        }
        if (bump === 'major') {
          bump = 'minor';
        }
        break;

      case 'majorFromRevision': {
        const contents = JSON.parse(await fs.readFile(value, 'utf-8'));
        if (semver.major(currentVersion) === contents.revision) {
          bump = `${semver.inc(currentVersion, 'minor')}`;
        } else {
          bump = `${contents.revision}.0.0`;
        }
        break;
      }

      case 'copyVersion': {
        const contents = JSON.parse(await fs.readFile(value, 'utf-8'));
        bump = `${contents.version}`;
        break;
      }

      case 'append':
        // If we have a relative bump type here still, we need to absolutize it
        // first before appending.
        bump = `${makeAbsolute(bump, currentVersion)}${value}`;
        break;

      case 'maybeRc': {
        bump = maybeRc(makeAbsolute(bump, currentVersion)) ?? bump;
        break;
      }

      case 'atLeast': {
        const v = makeAbsolute(bump, currentVersion);
        if (semver.lt(v, value)) {
          bump = value;
        }
        break;
      }

      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  }

  // this is a cli
  // eslint-disable-next-line no-console
  console.log(bump);
}

function maybeRc(version: string) {
  if (process.env.TESTING_CANDIDATE === 'true') {
    // To make an rc version for testing, we set the last component (either
    // patch or prerelease version) to 999.
    //
    // Adding `rc.0` causes problems for Amplify tests, which install
    // `aws-cdk@^2` which won't match the prerelease version.
    const originalPre = semver.prerelease(version);

    if (originalPre) {
      return version.replace(new RegExp('\\.' + originalPre[1] + '$'), '.999');
    } else {
      const patch = semver.patch(version);
      return version.replace(new RegExp('\\.' + patch + '$'), '.999');
    }
  }
}

type BumpType = 'major' | 'minor' | 'patch' | 'none';

function isBumpType(value: string): value is BumpType {
  return value === 'major' || value === 'minor' || value === 'patch' || value === 'none';
}

function makeAbsolute(bump: string, currentVersion: string) {
  if (!isBumpType(bump)) {
    return bump;
  }

  if (bump === 'none') {
    return currentVersion;
  }

  const ret = semver.inc(currentVersion, bump);
  if (ret == null) {
    throw new Error(`Could not bump: ${currentVersion} by ${bump}`);
  }
  return ret;
}

main().catch((error) => {
  // this is a cli
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
