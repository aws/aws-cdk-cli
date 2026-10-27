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
  const packageDir = path.join(installRoot, 'node_modules', PACKAGE_NAME);
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '7.8.9' }));
});

afterEach(async () => {
  await fs.rm(LINK_PATH, { force: true });
  await fs.rm(installRoot, { recursive: true, force: true });
});

test('fromInstallRoot links the installed package into cli-integ without installing it', async () => {
  const prepared = await RunnerLibraryGlobalInstallSource.fromInstallRoot(PACKAGE_NAME, installRoot).runnerPrepare();

  expect(shell).not.toHaveBeenCalled();
  expect(prepared.version).toEqual('7.8.9');
  expect(prepared.serialize()).toEqual([TestLibraryGlobalInstallSource, [PACKAGE_NAME, '7.8.9']]);
  expect(await fs.realpath(LINK_PATH)).toEqual(await fs.realpath(path.join(installRoot, 'node_modules', PACKAGE_NAME)));

  await prepared.dispose();
});

test('dispose removes the link and leaves the installed package alone', async () => {
  const prepared = await RunnerLibraryGlobalInstallSource.fromInstallRoot(PACKAGE_NAME, installRoot).runnerPrepare();

  await prepared.dispose();

  await expect(fs.lstat(LINK_PATH)).rejects.toThrow(/ENOENT/);
  await expect(fs.access(path.join(installRoot, 'node_modules', PACKAGE_NAME, 'package.json'))).resolves.toBeUndefined();
});
