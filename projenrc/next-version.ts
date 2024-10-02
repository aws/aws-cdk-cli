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
        if (process.env.TESTING_CANDIDATE === 'true') {
          // To make an rc version for testing, we set the last component (either
          // patch or prerelease version) to 999.
          //
          // Adding `rc.0` causes problems for Amplify tests, which install
          // `aws-cdk@^2` which won't match the prerelease version.
          const originalPre = semver.prerelease(version);

          if (originalPre) {
            version = version.replace(new RegExp('\\.' + originalPre[1] + '$'), '.999');
          } else {
            const patch = semver.patch(version);
            version = version.replace(new RegExp('\\.' + patch + '$'), '.999');
          }
        }
        break;
      }

      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  }

  if (version !== (process.env.VERSION ?? '')) {
    console.log(version);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
