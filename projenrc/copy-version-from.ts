import * as fs from 'fs';

/**
 * If any of the schema files changed, we need to bump the major version
 */
async function main() {
  const packageJsonFile = process.argv[2];

  const packageJson = JSON.parse(fs.readFileSync(packageJsonFile, 'utf8'));

  console.error(`Mirroring version from ${packageJson.name}: ${packageJson.version}`);
  console.log(packageJson.version);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});