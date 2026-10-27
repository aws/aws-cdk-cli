import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TestCliSource } from '../lib/package-sources/cli-npm-source';
import { RunnerCliPreinstalledSource } from '../lib/package-sources/cli-preinstalled-source';

const PACKAGE_NAME = 'cli-preinstalled-source-test-fixture-pkg';

let installRoot: string;

beforeEach(async () => {
  installRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-preinstalled-source-test-'));
});

afterEach(async () => {
  await fs.rm(installRoot, { recursive: true, force: true });
});

/**
 * Lay out a package the way `npm install` would in `installRoot`, optionally with its executable in `.bin`.
 */
async function installFakePackage(options: { linkBin: boolean }) {
  const packageDir = path.join(installRoot, 'node_modules', PACKAGE_NAME);
  await fs.mkdir(path.join(packageDir, 'bin'), { recursive: true });
  await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
    name: PACKAGE_NAME,
    version: '9.9.9',
    bin: { 'fake-cli': 'bin/fake-cli' },
  }));
  await fs.writeFile(path.join(packageDir, 'bin', 'fake-cli'), '#!/bin/sh\n');

  if (options.linkBin) {
    await fs.mkdir(path.join(installRoot, 'node_modules', '.bin'), { recursive: true });
    await fs.symlink(path.join(packageDir, 'bin', 'fake-cli'), path.join(installRoot, 'node_modules', '.bin', 'fake-cli'));
  }
}

test('uses the CLI installed in the given directory', async () => {
  await installFakePackage({ linkBin: true });

  const prepared = await new RunnerCliPreinstalledSource(PACKAGE_NAME, installRoot).runnerPrepare();

  expect(prepared.version).toBe('9.9.9');
  expect(prepared.serialize()).toEqual([TestCliSource, [installRoot, '9.9.9']]);
});

test('fails if the executables are not in node_modules/.bin', async () => {
  // Otherwise a different copy of the CLI further down the $PATH would be used
  await installFakePackage({ linkBin: false });

  await expect(new RunnerCliPreinstalledSource(PACKAGE_NAME, installRoot).runnerPrepare()).rejects.toThrow(
    /missing its executables: fake-cli/,
  );
});
