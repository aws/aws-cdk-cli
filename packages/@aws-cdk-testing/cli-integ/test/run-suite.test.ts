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

function runSuite(...args: string[]) {
  const result = spawnSync(process.execPath, [RUN_SUITE, 'cli-integ-tests', ...args], {
    encoding: 'utf-8',
    timeout: 60_000,
    env: {
      ...process.env,
      // Every case here must fail before contacting the registry; make sure it can't.
      npm_config_registry: 'http://127.0.0.1:9/',
      npm_config_offline: 'true',
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * Options that configure the CLI and cdk-assets without looking for the repository.
 *
 * They are only checked when the run starts preparing its sources, after the options
 * under test have been validated.
 */
function cliOptions() {
  return [`--cli-path=${installRoot}`, `--cdk-assets-path=${installRoot}`];
}

describe('a component configured with both a version and a path', () => {
  test.each([
    ['CLI version', '--cli-version=2.0.0', '--cli-path'],
    ['Framework version', '--framework-version=2.0.0', '--framework-path'],
    ['Toolkit lib version', '--toolkit-lib-version=1.0.0', '--toolkit-lib-path'],
  ])('fails for the %s', async (what, versionOption, pathOption) => {
    await installFakePackage('constructs');
    const otherOptions = cliOptions().filter(o => !o.startsWith(`${pathOption}=`));

    const { status, output } = runSuite(...otherOptions, versionOption, `${pathOption}=${installRoot}`);

    expect(status).toEqual(1);
    expect(output).toContain(`${what}: ${pathOption} already configured via ${versionOption.split('=')[0]}`);
  });
});

describe('--framework-path', () => {
  test('fails up front if constructs is not installed next to the framework', async () => {
    await installFakePackage('aws-cdk-lib');

    const { status, output } = runSuite(...cliOptions(), `--framework-path=${installRoot}`);

    expect(status).toEqual(1);
    expect(output).toContain(`constructs is not installed in ${installRoot}`);
    // Failed before reporting the configuration, so nothing was prepared
    expect(output).not.toContain('Configuration');
  });

  test('accepts a directory that has constructs installed', async () => {
    await installFakePackage('aws-cdk-lib');
    await installFakePackage('constructs');

    const { status, output } = runSuite(...cliOptions(), `--framework-path=${installRoot}`);

    // Gets past the option checks, and only then fails preparing the CLI, which is not installed
    expect(output).toContain(`Library source:     aws-cdk-lib installed in ${installRoot}`);
    expect(output).toContain(`aws-cdk is not installed in ${installRoot}`);
    expect(output).not.toContain('constructs is not installed');
    expect(status).toEqual(1);
  });
});
