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

  let version = process.env.VERSION ?? '';

  for (const arg of process.argv.slice(2)) {
    const [cmd, value] = arg.split(':');

    switch (cmd) {
      case 'majorFromRevision': {
        const contents = JSON.parse(await fs.readFile(value, 'utf-8'));
        if (semver.major(version) === contents.revision) {
          version = `${semver.inc(version, 'minor')}`;
        } else {
          version = `${contents.revision}.0.0`;
        }
        break;
      }

      case 'copyVersion': {
        const contents = JSON.parse(await fs.readFile(value, 'utf-8'));
        version = `${contents.version}`;
        break;
      }

      case 'append':
        version = `${version}${value}`;
        break;

      case 'maybeRc': {
        version = maybeRc(version) ?? version;
        break;
      }
      // this is a temporary case in order to support forcing a minor
      // version while still preserving rc capabilities for integ testing purposes.
      // once we refactor the release process to prevent incorporating breaking
      // changes from dependencies, this can (and should) be removed.
      // see https://github.com/projen/projen/pull/4156
      case 'maybeRcOrMinor':
        version = maybeRc(version) ?? 'minor';
        break;

      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  }

  if (version !== (process.env.VERSION ?? '')) {
    // this is a cli
    // eslint-disable-next-line no-console
    console.log(version);
  }
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

main().catch((error) => {
  // this is a cli
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
