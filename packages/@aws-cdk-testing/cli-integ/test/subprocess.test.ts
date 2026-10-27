import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TestCliSource } from '../lib/package-sources/cli-npm-source';
import { RunnerCliPreinstalledSource } from '../lib/package-sources/cli-preinstalled-source';
import { TestCliRepoSource } from '../lib/package-sources/cli-repo-source';
import { RunnerLibraryGlobalInstallSource, TestLibraryGlobalInstallSource } from '../lib/package-sources/library-globalinstall-source';
import { TestLibraryNpmSource } from '../lib/package-sources/library-npm-source';
import { RunnerLibraryPreinstalledSource, TestLibraryPreinstalledSource } from '../lib/package-sources/library-preinstalled-source';
import type { IPreparedRunnerSource } from '../lib/package-sources/source';
import { serializeSources, testSource } from '../lib/package-sources/subprocess';

// The runner serializes the sources it prepared into $SOURCES, and each test process
// rebuilds them by class name. A class missing from the list of known constructors only
// fails once a test process tries to rebuild it, so check every test-side source class.

const CLI_PACKAGE = 'subprocess-test-fixture-cli';
const LIBRARY_PACKAGE = 'subprocess-test-fixture-lib';
// Linked into cli-integ's own node_modules while prepared, so unique to this file
const TOOLKIT_PACKAGE = 'subprocess-test-fixture-toolkit';

let installRoot: string;
let originalSources: string | undefined;
const disposables = new Array<IPreparedRunnerSource<any>>();

beforeEach(async () => {
  installRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'subprocess-test-'));
  originalSources = process.env.SOURCES;
});

afterEach(async () => {
  for (const d of disposables.splice(0)) {
    await d.dispose();
  }
  if (originalSources === undefined) {
    delete process.env.SOURCES;
  } else {
    process.env.SOURCES = originalSources;
  }
  await fs.rm(installRoot, { recursive: true, force: true });
});

async function installFakePackage(name: string, version: string, bin?: Record<string, string>) {
  const packageDir = path.join(installRoot, 'node_modules', name);
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name, version, bin }));

  for (const [binName, binPath] of Object.entries(bin ?? {})) {
    await fs.mkdir(path.join(packageDir, path.dirname(binPath)), { recursive: true });
    await fs.writeFile(path.join(packageDir, binPath), '#!/bin/sh\n');
    await fs.mkdir(path.join(installRoot, 'node_modules', '.bin'), { recursive: true });
    await fs.symlink(path.join(packageDir, binPath), path.join(installRoot, 'node_modules', '.bin', binName));
  }
}

async function prepare<A>(p: Promise<IPreparedRunnerSource<A>>): Promise<IPreparedRunnerSource<A>> {
  const prepared = await p;
  disposables.push(prepared);
  return prepared;
}

/**
 * A prepared source that serializes to the given descriptor, for sources that
 * can only be prepared from the registry or a repository checkout.
 */
function serializesTo(descriptor: ReturnType<IPreparedRunnerSource<any>['serialize']>): IPreparedRunnerSource<any> {
  return { version: '0.0.0', dispose: () => Promise.resolve(), serialize: () => descriptor };
}

test('sources for packages installed in a given directory can be rebuilt in a test process', async () => {
  await installFakePackage(CLI_PACKAGE, '1.0.0', { 'fixture-cli': 'bin/fixture-cli' });
  await installFakePackage(LIBRARY_PACKAGE, '2.0.0');
  await installFakePackage(TOOLKIT_PACKAGE, '3.0.0');

  serializeSources({
    cli: await prepare(new RunnerCliPreinstalledSource(CLI_PACKAGE, installRoot).runnerPrepare()),
    cdkAssets: await prepare(new RunnerCliPreinstalledSource(CLI_PACKAGE, installRoot).runnerPrepare()),
    library: await prepare(new RunnerLibraryPreinstalledSource(LIBRARY_PACKAGE, installRoot).runnerPrepare()),
    toolkitLib: await prepare(RunnerLibraryGlobalInstallSource.fromInstallRoot(TOOLKIT_PACKAGE, installRoot).runnerPrepare()),
  });

  expect(testSource('cli')).toBeInstanceOf(TestCliSource);
  expect(testSource('cdkAssets')).toBeInstanceOf(TestCliSource);
  expect(testSource('library')).toBeInstanceOf(TestLibraryPreinstalledSource);
  expect(testSource('library').installRoot).toEqual(installRoot);
  expect(testSource('toolkitLib')).toBeInstanceOf(TestLibraryGlobalInstallSource);
  expect(testSource('toolkitLib').requestedVersion()).toEqual('3.0.0');
});

test('sources for packages from the registry or the repository can be rebuilt in a test process', () => {
  serializeSources({
    cli: serializesTo([TestCliRepoSource, ['/repo/packages/aws-cdk/bin']]),
    cdkAssets: serializesTo([TestCliSource, ['/install/root', 'latest']]),
    library: serializesTo([TestLibraryNpmSource, ['aws-cdk-lib', '2.100.0']]),
    toolkitLib: serializesTo([TestLibraryPreinstalledSource, ['@aws-cdk/toolkit-lib', '1.0.0']]),
  });

  expect(testSource('cli')).toBeInstanceOf(TestCliRepoSource);
  expect(testSource('cdkAssets')).toBeInstanceOf(TestCliSource);
  expect(testSource('library')).toBeInstanceOf(TestLibraryNpmSource);
  expect(testSource('library').requestedVersion()).toEqual('2.100.0');
  expect(testSource('toolkitLib')).toBeInstanceOf(TestLibraryPreinstalledSource);
  expect(testSource('toolkitLib').installRoot).toBeUndefined();
});
