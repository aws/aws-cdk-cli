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
          const originalPrereleaseTag = semver.prerelease(version)?.[0];

          const rc = semver.inc(version, 'prerelease', originalPrereleaseTag ? `${originalPrereleaseTag}` : 'test');
          if (!rc) {
            throw new Error(`Unable to increment ${version}`);
          }
          version = `${rc}`;
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
