import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TestCliSource } from '../lib/package-sources/cli-npm-source';
import { RunnerCliPreinstalledSource } from '../lib/package-sources/cli-preinstalled-source';
import { RunnerLibraryGlobalInstallSource, TestLibraryGlobalInstallSource } from '../lib/package-sources/library-globalinstall-source';
import { RunnerLibraryPreinstalledSource, TestLibraryPreinstalledSource } from '../lib/package-sources/library-preinstalled-source';
import type { IPreparedRunnerSource } from '../lib/package-sources/source';
import { serializeSources, testSource } from '../lib/package-sources/subprocess';

const CLI_PACKAGE = 'package-sources-test-fixture-cli';
const LIBRARY_PACKAGE = 'package-sources-test-fixture-lib';
// Linked into cli-integ's own node_modules while prepared, so unique to this file
const TOOLKIT_PACKAGE = 'package-sources-test-fixture-toolkit';

let installRoot: string;
let originalSources: string | undefined;
const disposables = new Array<IPreparedRunnerSource<any>>();

beforeEach(async () => {
  installRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'package-sources-test-'));
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

/**
 * Lay out a package the way `npm install` would in `installRoot`, with its executables optionally linked into `.bin`.
 */
async function installFakePackage(name: string, version: string, options: { bin?: string; linkBin?: boolean } = {}) {
  const packageDir = path.join(installRoot, 'node_modules', name);
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
    name,
    version,
    bin: options.bin ? { [options.bin]: `bin/${options.bin}` } : undefined,
  }));

  if (options.bin) {
    await fs.mkdir(path.join(packageDir, 'bin'), { recursive: true });
    await fs.writeFile(path.join(packageDir, 'bin', options.bin), '#!/bin/sh\n');
    if (options.linkBin ?? true) {
      await fs.mkdir(path.join(installRoot, 'node_modules', '.bin'), { recursive: true });
      await fs.symlink(path.join(packageDir, 'bin', options.bin), path.join(installRoot, 'node_modules', '.bin', options.bin));
    }
  }
}

async function prepare<A>(p: Promise<IPreparedRunnerSource<A>>): Promise<IPreparedRunnerSource<A>> {
  const prepared = await p;
  disposables.push(prepared);
  return prepared;
}

test('sources for packages installed in a given directory are used without installing, and rebuild in a test process', async () => {
  await installFakePackage(CLI_PACKAGE, '1.0.0', { bin: 'fixture-cli' });
  await installFakePackage(LIBRARY_PACKAGE, '2.0.0');
  await installFakePackage(TOOLKIT_PACKAGE, '3.0.0');

  const cli = await prepare(new RunnerCliPreinstalledSource(CLI_PACKAGE, installRoot).runnerPrepare());
  const library = await prepare(new RunnerLibraryPreinstalledSource(LIBRARY_PACKAGE, installRoot).runnerPrepare());
  const toolkitLib = await prepare(RunnerLibraryGlobalInstallSource.fromInstallRoot(TOOLKIT_PACKAGE, installRoot).runnerPrepare());

  // Versions come from the installed packages
  expect([cli.version, library.version, toolkitLib.version]).toEqual(['1.0.0', '2.0.0', '3.0.0']);

  // The runner hands the sources to test processes through $SOURCES, which rebuild them by class name
  serializeSources({ cli, cdkAssets: cli, library, toolkitLib });

  expect(testSource('cli')).toEqual(new TestCliSource(installRoot, '1.0.0'));
  expect(testSource('library')).toBeInstanceOf(TestLibraryPreinstalledSource);
  expect(testSource('library').installRoot).toEqual(installRoot);
  expect(testSource('toolkitLib')).toBeInstanceOf(TestLibraryGlobalInstallSource);
});

test('a CLI installed in a given directory fails if its executables are not in node_modules/.bin', async () => {
  // Otherwise a different copy of the CLI further down the $PATH would be used
  await installFakePackage(CLI_PACKAGE, '1.0.0', { bin: 'fixture-cli', linkBin: false });

  await expect(new RunnerCliPreinstalledSource(CLI_PACKAGE, installRoot).runnerPrepare()).rejects.toThrow(
    /missing its executables: fixture-cli/,
  );
});
