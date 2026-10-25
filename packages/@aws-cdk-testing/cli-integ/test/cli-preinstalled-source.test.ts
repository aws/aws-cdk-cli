import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TestCliSource } from '../lib/package-sources/cli-npm-source';
import { RunnerCliPreinstalledSource } from '../lib/package-sources/cli-preinstalled-source';

// `RunnerCliPreinstalledSource` searches for packages from the real `<cli-integ>/tests` directory.
// To exercise the real lookup (not just reimplement it in the test), we drop a fake package into
// that directory's `node_modules` for the duration of the test, under a name that can't collide
// with anything actually installed.
const FAKE_PACKAGE_NAME = 'cli-preinstalled-source-test-fixture-pkg';
const testsDir = path.resolve(__dirname, '..', 'tests');
const fakePackageDir = path.join(testsDir, 'node_modules', FAKE_PACKAGE_NAME);

let elsewhere: string | undefined;

afterEach(async () => {
  await fs.rm(fakePackageDir, { recursive: true, force: true });
  if (elsewhere) {
    await fs.rm(elsewhere, { recursive: true, force: true });
    elsewhere = undefined;
  }
});

async function writeFakePackage(dir: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: FAKE_PACKAGE_NAME, version: '9.9.9' }));
}

test('resolves version and install root from a preinstalled package under tests/node_modules', async () => {
  await writeFakePackage(fakePackageDir);

  const prepared = await new RunnerCliPreinstalledSource(FAKE_PACKAGE_NAME).runnerPrepare();

  expect(prepared.version).toBe('9.9.9');
  expect(prepared.serialize()).toEqual([TestCliSource, [testsDir, '9.9.9']]);
});

test('uses the directory the package is linked into, not where the link points', async () => {
  // A preinstalled package is often a symlink to a build somewhere else. Its `.bin`
  // entries live next to the link, so that's the install root to use.
  elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-preinstalled-source-test-'));
  await writeFakePackage(path.join(elsewhere, FAKE_PACKAGE_NAME));
  await fs.mkdir(path.dirname(fakePackageDir), { recursive: true });
  await fs.symlink(path.join(elsewhere, FAKE_PACKAGE_NAME), fakePackageDir, 'dir');

  const prepared = await new RunnerCliPreinstalledSource(FAKE_PACKAGE_NAME).runnerPrepare();

  expect(prepared.serialize()).toEqual([TestCliSource, [testsDir, '9.9.9']]);
});

test('throws a clear, actionable error when the package is not preinstalled', async () => {
  const source = new RunnerCliPreinstalledSource('a-package-that-definitely-does-not-exist-anywhere');

  await expect(source.runnerPrepare()).rejects.toThrow(
    /a-package-that-definitely-does-not-exist-anywhere not found preinstalled/,
  );
});
