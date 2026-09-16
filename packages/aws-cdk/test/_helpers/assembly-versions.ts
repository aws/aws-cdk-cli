import * as fs from 'fs';
import * as cxapi from '@aws-cdk/cloud-assembly-api';
import { StackAssembly } from '../../lib/api';
import { BorrowedAssembly } from '../../lib/api-private';
import { TestIoHost } from '../_helpers/io-host';

/**
 * The cloud-assembly-schema in the new monorepo will use its own package version as the schema version, which is always `0.0.0` when tests are running.
 *
 * If we want to test the CLI's behavior when presented with specific schema versions, we will have to
 * mutate `manifest.json` on disk after writing it, and write the schema version that we want to test for in there.
 *
 * After we raise the schema version in the file on disk from `0.0.0` to
 * `30.0.0`, `cx-api` will refuse to load `manifest.json` back, because the
 * version is higher than its own package version ("Maximum schema version
 * supported is 0.x.x, but found 30.0.0"), so we have to turn on `skipVersionCheck`.
 */
export function cxapiAssemblyWithForcedVersion(asm: cxapi.CloudAssembly, version: string) {
  rewriteManifestVersion(asm.directory, version);
  return new cxapi.CloudAssembly(asm.directory, { skipVersionCheck: true });
}

/**
 * The CLI uses toolkit-lib's `StackAssembly` which wraps the cxapi CloudAssembly class
 */
export function cliAssemblyWithForcedVersion(asm: StackAssembly, version: string) {
  rewriteManifestVersion(asm.directory, version);
  const reloaded = new cxapi.CloudAssembly(asm.directory, { skipVersionCheck: true });
  return new StackAssembly(new BorrowedAssembly(reloaded), new TestIoHost().asHelper('synth'));
}

export function rewriteManifestVersion(directory: string, version: string) {
  const manifestFile = `${directory}/manifest.json`;
  const contents = JSON.parse(fs.readFileSync(`${directory}/manifest.json`, 'utf-8'));
  contents.version = version;
  fs.writeFileSync(manifestFile, JSON.stringify(contents, undefined, 2));
}

export function rewriteManifestMinimumCliVersion(directory: string, version: string) {
  const manifestFile = `${directory}/manifest.json`;
  const contents = JSON.parse(fs.readFileSync(`${directory}/manifest.json`, 'utf-8'));
  contents.minimumCliVersion = version;
  fs.writeFileSync(manifestFile, JSON.stringify(contents, undefined, 2));
}
