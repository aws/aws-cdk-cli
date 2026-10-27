import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

// run-suite parses its arguments and runs as soon as it is loaded, so run it as a
// separate process. This runs the compiled script: compile before running these tests.
const RUN_SUITE = path.join(__dirname, '..', 'lib', 'cli', 'run-suite.js');

let installRoot: string;

beforeEach(async () => {
  installRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'run-suite-test-'));
});

afterEach(async () => {
  await fs.rm(installRoot, { recursive: true, force: true });
});

async function installFakePackage(name: string) {
  const packageDir = path.join(installRoot, 'node_modules', name);
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
}

/**
 * Run run-suite with the CLI and cdk-assets taken from `installRoot`, so it doesn't look for the repository.
 */
function runSuite(...args: string[]) {
  const result = spawnSync(process.execPath, [
    RUN_SUITE, 'cli-integ-tests', `--cli-path=${installRoot}`, `--cdk-assets-path=${installRoot}`, ...args,
  ], {
    encoding: 'utf-8',
    timeout: 60_000,
    env: {
      ...process.env,
      // Both cases must fail before contacting the registry; make sure it can't.
      npm_config_registry: 'http://127.0.0.1:9/',
      npm_config_offline: 'true',
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test('fails if the framework is given both a version and a path', async () => {
  await installFakePackage('aws-cdk-lib');
  await installFakePackage('constructs');

  const { status, output } = runSuite('--framework-version=2.0.0', `--framework-path=${installRoot}`);

  expect(status).toEqual(1);
  expect(output).toContain('Framework version: --framework-path already configured via --framework-version');
});

test('fails up front if constructs is not installed next to the framework', async () => {
  await installFakePackage('aws-cdk-lib');

  const { status, output } = runSuite(`--framework-path=${installRoot}`);

  expect(status).toEqual(1);
  expect(output).toContain(`constructs is not installed in ${installRoot}`);
  // Failed before reporting the configuration, so nothing was prepared
  expect(output).not.toContain('Configuration');
});
