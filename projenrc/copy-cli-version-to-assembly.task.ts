import { promises as fs } from 'fs';

/**
 * Copy the version from the CLI into the `@aws-cdk/cloud-assembly-schema` package at release time.
 */
async function main() {
  const cliVersion = JSON.parse(await fs.readFile('packages/aws-cdk/package.json', 'utf8')).version;

  if (cliVersion !== '0.0.0') {
    await fs.writeFile('packages/@aws-cdk/cloud-assembly-schema/cli-version.json', JSON.stringify({ version: cliVersion }), 'utf8');
  }
}

main().catch(e => {
  // this is effectively a mini-cli
  // eslint-disable-next-line no-console
  console.error(e);
  process.exitCode = 1;
});
