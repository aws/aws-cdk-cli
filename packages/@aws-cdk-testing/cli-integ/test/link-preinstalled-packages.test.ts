import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { linkPreinstalledPackages } from '../lib/with-cdk-app';

const PLAIN_PACKAGE = 'link-preinstalled-packages-test-fixture-pkg';
const SCOPED_PACKAGE = '@link-preinstalled-packages-test-fixture/scoped-pkg';

let installRoot: string;
let integTestDir: string;

beforeEach(async () => {
  installRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'link-preinstalled-packages-root-'));
  integTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'link-preinstalled-packages-test-'));
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

function noLog(_s: string) {
  return undefined;
}

test('links installed packages into the test directory without installing', async () => {
  await preinstall(PLAIN_PACKAGE, '1.2.3');
  await preinstall(SCOPED_PACKAGE, '4.5.6');

  linkPreinstalledPackages(installRoot, integTestDir, {
    [PLAIN_PACKAGE]: '1.2.3',
    [SCOPED_PACKAGE]: '^4',
  }, noLog);

  // The packages resolve from the test directory, as an app in that directory would load them
  for (const name of [PLAIN_PACKAGE, SCOPED_PACKAGE]) {
    const resolved = require.resolve(`${name}/package.json`, { paths: [integTestDir] });
    expect(await fs.realpath(path.dirname(resolved))).toEqual(await fs.realpath(path.join(installRoot, 'node_modules', name)));
  }
});

test('fails listing every package that is not installed', async () => {
  await preinstall(PLAIN_PACKAGE, '1.2.3');

  expect(() => linkPreinstalledPackages(installRoot, integTestDir, {
    [PLAIN_PACKAGE]: '1.2.3',
    'link-preinstalled-packages-test-missing-one': '1.0.0',
    'link-preinstalled-packages-test-missing-two': '1.0.0',
  }, noLog)).toThrow(/not installed in .*: link-preinstalled-packages-test-missing-one, link-preinstalled-packages-test-missing-two/);

  // Nothing was linked, since the install did not proceed
  await expect(fs.access(path.join(integTestDir, 'node_modules'))).rejects.toThrow();
});
