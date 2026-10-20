import { promises as fs } from 'fs';
import * as path from 'path';
import { RunnerCliPreinstalledSource } from '../lib/package-sources/cli-preinstalled-source';

// `RunnerCliPreinstalledSource` resolves packages via `require.resolve(..., { paths: [searchPath] })`
// where `searchPath` is hardcoded to `<cli-integ>/tests` (mirroring `RunnerLibraryPreinstalledSource`).
// To exercise the real resolution logic (not just reimplement it in the test), we drop a fake
// package into that real directory's `node_modules` for the duration of the test, under a name
// that can't collide with anything actually installed.
const FAKE_PACKAGE_NAME = 'cli-preinstalled-source-test-fixture-pkg';
const testsNodeModules = path.resolve(__dirname, '..', 'tests', 'node_modules');
const fakePackageDir = path.join(testsNodeModules, FAKE_PACKAGE_NAME);

afterEach(async () => {
  await fs.rm(fakePackageDir, { recursive: true, force: true });
});

test('resolves version and .bin dir from a preinstalled package under tests/node_modules', async () => {
  await fs.mkdir(fakePackageDir, { recursive: true });
  await fs.writeFile(
    path.join(fakePackageDir, 'package.json'),
    JSON.stringify({ name: FAKE_PACKAGE_NAME, version: '9.9.9' }),
  );

  const source = new RunnerCliPreinstalledSource(FAKE_PACKAGE_NAME);
  const prepared = await source.runnerPrepare();

  expect(prepared.version).toBe('9.9.9');

  const [, args] = prepared.serialize();
  expect(args).toEqual([path.join(testsNodeModules, '.bin'), '9.9.9']);
});

test('throws a clear, actionable error when the package is not preinstalled', async () => {
  const source = new RunnerCliPreinstalledSource('a-package-that-definitely-does-not-exist-anywhere');

  await expect(source.runnerPrepare()).rejects.toThrow(
    /a-package-that-definitely-does-not-exist-anywhere not found preinstalled/,
  );
});
