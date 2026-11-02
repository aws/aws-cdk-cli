/**
 * Generates `dist/versions.json`, describing the versions of the toolkit
 * packages that are part of the current build.
 *
 * The release workflow zips this file into `dist/toolkit-versions.zip` and publishes
 * it to the docs bucket (see `S3DocsPublishing` in `.projenrc.ts`).
 *
 * Package versions are read from the respective `package.json` files. During
 * a release build these have been bumped to the versions being published;
 * in a regular dev build they are `0.0.0`.
 */
import * as path from 'path';
import * as fs from 'fs-extra';

interface TrackedPackage {
  readonly name: string;
  readonly docsUrl: string;
  readonly packageJsonPath: string;
}

const TRACKED_PACKAGES: TrackedPackage[] = [
  {
    name: 'aws-cdk',
    docsUrl: 'https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd.html',
    packageJsonPath: path.join(__dirname, '..', 'package.json'),
  },
  {
    name: '@aws-cdk/toolkit-lib',
    docsUrl: 'https://docs.aws.amazon.com/cdk/api/toolkit-lib/',
    packageJsonPath: require.resolve('@aws-cdk/toolkit-lib/package.json'),
  },
  {
    name: '@aws-cdk/cloud-assembly-schema',
    docsUrl: 'https://docs.aws.amazon.com/cdk/api/v2/docs/cloud-assembly-schema-readme.html',
    packageJsonPath: require.resolve('@aws-cdk/cloud-assembly-schema/package.json'),
  },
];

async function main() {
  const now = new Date().toISOString();

  const versions = {
    generatedAt: now,
    packages: TRACKED_PACKAGES.map((pkg) => ({
      package: pkg.name,
      version: (fs.readJSONSync(pkg.packageJsonPath) as { version: string }).version,
      date: now,
      docsUrl: pkg.docsUrl,
    })),
  };

  const outFile = path.join(__dirname, '..', 'dist', 'versions.json');
  fs.mkdirpSync(path.dirname(outFile));
  fs.writeJSONSync(outFile, versions, { spaces: 2 });
}

main().catch((e) => {
  throw e;
});
