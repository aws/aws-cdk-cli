import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import { NpmPackageInstaller, packageInstallerFor, PreinstalledPackageInstaller } from '../lib/package-installer';
import { TestLibraryNpmSource } from '../lib/package-sources/library-npm-source';
import { TestLibraryPreinstalledSource } from '../lib/package-sources/library-preinstalled-source';

const PLAIN_PACKAGE = 'package-installer-test-fixture-pkg';
const SCOPED_PACKAGE = '@package-installer-test-fixture/scoped-pkg';

let installRoot: string;
let integTestDir: string;
let logs: string[];

beforeEach(async () => {
  installRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'package-installer-root-'));
  integTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'package-installer-test-'));
  logs = [];
});

afterEach(async () => {
  await fs.rm(installRoot, { recursive: true, force: true });
  await fs.rm(integTestDir, { recursive: true, force: true });
});

async function preinstall(name: string, version: string) {
  const dir = path.join(installRoot, 'node_modules', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
}

function context() {
  return { integTestDir, output: new PassThrough(), log: (s: string) => logs.push(s) };
}

describe('PreinstalledPackageInstaller', () => {
  test('links installed packages into the test directory without installing', async () => {
    await preinstall(PLAIN_PACKAGE, '1.2.3');
    await preinstall(SCOPED_PACKAGE, '4.5.6');

    await new PreinstalledPackageInstaller(installRoot).install(context(), {
      [PLAIN_PACKAGE]: '1.2.3',
      [SCOPED_PACKAGE]: '^4',
    });

    // The packages resolve from the test directory, as an app in that directory would load them
    for (const [name, version] of [[PLAIN_PACKAGE, '1.2.3'], [SCOPED_PACKAGE, '4.5.6']]) {
      const resolved = require.resolve(`${name}/package.json`, { paths: [integTestDir] });
      expect(await fs.realpath(path.dirname(resolved))).toEqual(await fs.realpath(path.join(installRoot, 'node_modules', name)));
      expect(JSON.parse(await fs.readFile(resolved, 'utf-8')).version).toEqual(version);
    }

    const packageJson = JSON.parse(await fs.readFile(path.join(integTestDir, 'package.json'), 'utf-8'));
    expect(packageJson.devDependencies).toEqual({ [PLAIN_PACKAGE]: '1.2.3', [SCOPED_PACKAGE]: '^4' });
    await expect(fs.access(path.join(integTestDir, 'package-lock.json'))).resolves.toBeUndefined();
  });

  test('fails listing every package that is not installed', async () => {
    await preinstall(PLAIN_PACKAGE, '1.2.3');

    await expect(new PreinstalledPackageInstaller(installRoot).install(context(), {
      [PLAIN_PACKAGE]: '1.2.3',
      'package-installer-test-missing-one': '1.0.0',
      'package-installer-test-missing-two': '1.0.0',
    })).rejects.toThrow(/not installed in .*: package-installer-test-missing-one, package-installer-test-missing-two/);

    // Nothing was linked, since the install did not proceed
    await expect(fs.access(path.join(integTestDir, 'node_modules'))).rejects.toThrow();
  });

  test('uses the installed version even if it does not match the request, and says so', async () => {
    await preinstall(PLAIN_PACKAGE, '1.2.3');

    await new PreinstalledPackageInstaller(installRoot).install(context(), { [PLAIN_PACKAGE]: '^2' });

    expect(logs).toContainEqual(expect.stringContaining(`${PLAIN_PACKAGE}@1.2.3, which does not satisfy the requested '^2'`));
  });
});

describe('packageInstallerFor', () => {
  test('reuses installed packages when the framework has an install directory', () => {
    expect(packageInstallerFor(new TestLibraryPreinstalledSource('aws-cdk-lib', '2.0.0', '/some/dir'))).toBeInstanceOf(PreinstalledPackageInstaller);
  });

  test('installs from the registry otherwise', () => {
    expect(packageInstallerFor(new TestLibraryNpmSource('aws-cdk-lib', '2.0.0'))).toBeInstanceOf(NpmPackageInstaller);
    expect(packageInstallerFor(new TestLibraryPreinstalledSource('aws-cdk-lib', '2.0.0'))).toBeInstanceOf(NpmPackageInstaller);
  });
});
