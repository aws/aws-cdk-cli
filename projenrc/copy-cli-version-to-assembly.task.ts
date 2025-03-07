import { promises as fs } from 'fs';

/**
 * Copy the version from the CLI into the `@aws-cdk/cloud-assembly-schema` package at release time.
 */
async function main() {
  const cliVersion = JSON.parse(await fs.readFile(`${__dirname}/../packages/aws-cdk/package.json`, 'utf8')).version;

  const cliVersionFile = `${__dirname}/../packages/@aws-cdk/cloud-assembly-schema/cli-version.json`;

  // We write an empty string if we're in "development mode" to show that we don't really have a version.
  // It's not a missing field so that the `import` statement of that JSON file in TypeScript
  // always knows the version field is there, and its value is a string.
  const advertisedVersion = cliVersion !== '0.0.0' ? cliVersion : '';

  await fs.writeFile(cliVersionFile, JSON.stringify({ version: advertisedVersion }), 'utf8');
}

main().catch(e => {
  // this is effectively a mini-cli
  // eslint-disable-next-line no-console
  console.error(e);
  process.exitCode = 1;
});
