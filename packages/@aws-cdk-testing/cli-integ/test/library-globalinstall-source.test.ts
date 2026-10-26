import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RunnerLibraryGlobalInstallSource, TestLibraryGlobalInstallSource } from '../lib/package-sources/library-globalinstall-source';
import { shell } from '../lib/shell';

jest.mock('../lib/shell', () => ({
  ...jest.requireActual('../lib/shell'),
  shell: jest.fn(),
}));

// Linked into cli-integ's own node_modules while prepared, so unique to this file
const PACKAGE_NAME = 'library-globalinstall-source-test-fixture-pkg';
const LINK_PATH = path.join(__dirname, '..', 'node_modules', PACKAGE_NAME);

let installRoot: string;

beforeEach(async () => {
  installRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'library-globalinstall-source-test-'));
});

afterEach(async () => {
  await fs.rm(LINK_PATH, { force: true });
  await fs.rm(installRoot, { recursive: true, force: true });
});

async function installFakePackage(version: string) {
  const packageDir = path.join(installRoot, 'node_modules', PACKAGE_NAME);
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version }));
}

describe('fromInstallRoot', () => {
  test('links the installed package into cli-integ without installing it', async () => {
    await installFakePackage('7.8.9');

    const source = RunnerLibraryGlobalInstallSource.fromInstallRoot(PACKAGE_NAME, installRoot);
    const prepared = await source.runnerPrepare();

    expect(shell).not.toHaveBeenCalled();
    expect(source.sourceDescription).toEqual(`${PACKAGE_NAME} installed in ${installRoot}`);
    expect(prepared.version).toEqual('7.8.9');
    expect(prepared.serialize()).toEqual([TestLibraryGlobalInstallSource, [PACKAGE_NAME, '7.8.9']]);
    expect(await fs.realpath(LINK_PATH)).toEqual(await fs.realpath(path.join(installRoot, 'node_modules', PACKAGE_NAME)));

    await prepared.dispose();
  });

  test('removes the link again, and leaves the installed package alone, on dispose', async () => {
    await installFakePackage('7.8.9');

    const prepared = await RunnerLibraryGlobalInstallSource.fromInstallRoot(PACKAGE_NAME, installRoot).runnerPrepare();
    await prepared.dispose();

    await expect(fs.lstat(LINK_PATH)).rejects.toThrow(/ENOENT/);
    await expect(fs.access(path.join(installRoot, 'node_modules', PACKAGE_NAME, 'package.json'))).resolves.toBeUndefined();
  });

  test('resolves a relative install directory', async () => {
    await installFakePackage('7.8.9');

    const source = RunnerLibraryGlobalInstallSource.fromInstallRoot(PACKAGE_NAME, path.relative(process.cwd(), installRoot));

    expect(source.sourceDescription).toEqual(`${PACKAGE_NAME} installed in ${installRoot}`);
  });

  test('fails if the package is not installed there, without installing it', async () => {
    await expect(RunnerLibraryGlobalInstallSource.fromInstallRoot(PACKAGE_NAME, installRoot).runnerPrepare()).rejects.toThrow(
      `${PACKAGE_NAME} is not installed in ${installRoot}`,
    );

    expect(shell).not.toHaveBeenCalled();
    await expect(fs.lstat(LINK_PATH)).rejects.toThrow(/ENOENT/);
  });
});
