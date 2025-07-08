/* eslint-disable no-console */
import * as path from 'path';
import * as jest from 'jest';
import * as yargs from 'yargs';
import { RunnerCliNpmSource } from '../package-sources/cli-npm-source';
import { RunnerCliRepoSource } from '../package-sources/cli-repo-source';
import { autoFindRepoRoot } from '../package-sources/find-root';
import { RunnerLibraryGlobalInstallSource } from '../package-sources/library-globalinstall-source';
import { RunnerLibraryNpmSource } from '../package-sources/library-npm-source';
import { RunnerLibraryPreinstalledSource } from '../package-sources/library-preinstalled-source';
import type { IRunnerSource, ITestCliSource, ITestLibrarySource } from '../package-sources/source';
import { serializeSources } from '../package-sources/subprocess';

const CLI_PACKAGE_NAME = 'aws-cdk';
const CDK_ASSETS_PACKAGE_NAME = 'cdk-assets';

async function main() {
  const args = await yargs
    .command('* <SUITENAME>', 'default command', y => y
      .positional('SUITENAME', {
        describe: 'Name of the test suite to run',
        type: 'string',
        demandOption: true,
      })
      /////////////////////////////////////////////////////////////////////////////
      //  Sources and versions
      .options('cli-version', {
        describe: 'CLI version to use.',
        alias: 'c',
        type: 'string',
      })
      .options('cli-source', {
        describe: 'Root of aws-cdk-cli repository, or "auto".',
        alias: 's',
        type: 'string',
      })
      .options('framework-version', {
        describe: 'Framework version to use',
        alias: 'f',
        type: 'string',
      })
      .options('toolkit-lib-version', {
        describe: 'Toolkit lib version to use',
        alias: 'l',
        type: 'string',
      })
      .options('cdk-assets-version', {
        describe: 'cdk-assets version to use.',
        alias: 'a',
        type: 'string',
      })
      .option('use-source', {
        descripton: 'Use TypeScript packages from the given source repository (or "auto")',
        type: 'string',
        requiresArg: true,
        deprecated: 'Use --cli-source instead',
      })
      .option('use-cli-release', {
        descripton: 'Run the current tests against the CLI at the given version',
        alias: 'u',
        type: 'string',
        requiresArg: true,
        deprecated: 'Use --cli-version instead',
      })
      .option('auto-source', {
        alias: 'a',
        describe: 'Automatically find the source tree from the current working directory',
        type: 'boolean',
        requiresArg: false,
        deprecated: 'Use --use-source=auto instead',
      })
      /////////////////////////////////////////////////////////////////////////////
      //  Test running flags
      .option('runInBand', {
        descripton: 'Run all tests in one Node process',
        alias: 'i',
        type: 'boolean',
      })
      .option('test', {
        descripton: 'Test pattern to selectively run tests',
        alias: 't',
        type: 'string',
        requiresArg: true,
      })
      .option('test-file', {
        describe: 'The specific test file to run',
        alias: 'F',
        type: 'string',
        requiresArg: true,
      })
      .options('verbose', {
        alias: 'v',
        describe: 'Run in verbose mode',
        type: 'boolean',
        requiresArg: false,
      })
      .options('passWithNoTests', {
        describe: 'Allow passing if the test suite is not found (default true when IS_CANARY mode, false otherwise)',
        type: 'boolean',
        requiresArg: false,
      })
      .options('maxWorkers', {
        alias: 'w',
        describe: 'Specifies the maximum number of workers the worker-pool will spawn for running tests. We use a sensible default for running cli integ tests.',
        type: 'string',
        requiresArg: true,
      }), () => {
    },
    )
    .strict()
    .parse();

  const suiteName = args.SUITENAME;

  // So many ways to specify this, and with various ways to spell the same flag (o_O)
  // Also, some of them depend on each other for convenience.
  const cliSource = new UniqueOption<IRunnerSource<ITestCliSource>>('CLI version');
  const cdkAssetsSource = new UniqueOption<IRunnerSource<ITestCliSource>>('cdk-assets version');

  // Specific CLI version
  for (const flagAlias of ['cli-version', 'use-cli-release'] as const) {
    if (args[flagAlias]) {
      cliSource.set(new RunnerCliNpmSource(CLI_PACKAGE_NAME, args[flagAlias]), `--${flagAlias}`);
    }
  }

  // Specific cdk-assets version
  if (args['cdk-assets-version']) {
    cdkAssetsSource.set(new RunnerCliNpmSource(CDK_ASSETS_PACKAGE_NAME, args['cdk-assets-version']), '--cdk-assets-version');
  }

  // Specifically use a source location
  for (const flagAlias of ['cli-source', 'use-source'] as const) {
    if (args[flagAlias]) {
      const root = args[flagAlias] === 'auto' ? await autoFindRepoRoot() : args[flagAlias];
      cliSource.set(new RunnerCliRepoSource(CLI_PACKAGE_NAME, root), `--${flagAlias}`);
      cdkAssetsSource.set(new RunnerCliRepoSource(CDK_ASSETS_PACKAGE_NAME, root), `--${flagAlias}`);
    }
  }

  // Specifically request that a source location is given, or we didn't find a CLI yet.
  // A CLI source is required, so if this fails that's alright.
  if (args['auto-source'] || !cliSource.isSet()) {
    cliSource.set(new RunnerCliRepoSource(CLI_PACKAGE_NAME, await autoFindRepoRoot()), '--auto-source');
  }

  // If the CLI is taken from the source, and cdk-assets is not set, we can copy the cdk-assets source from the CLI source.
  if (!cdkAssetsSource.isSet()) {
    const cliSrc = cliSource.assert();
    if (cliSrc instanceof RunnerCliRepoSource) {
      cdkAssetsSource.set(new RunnerCliRepoSource(CDK_ASSETS_PACKAGE_NAME, cliSrc.repoRoot), 'copied from CLI source');
    }
  }

  // If cdk-assets is still not configured, fall back to the latest version that is available
  if (!cdkAssetsSource.isSet()) {
    cdkAssetsSource.set(new RunnerCliNpmSource(CDK_ASSETS_PACKAGE_NAME, 'latest'), '--cdk-assets-version not set');
  }

  // Library source is either the given one, or 'latest' (nice and simple)
  const librarySource: IRunnerSource<ITestLibrarySource>
    = new RunnerLibraryNpmSource('aws-cdk-lib', args['framework-version'] ? args['framework-version'] : 'latest');

  // Toolkit lib source is either the given one, or the one that's being brought by 'package.json' already, or 'latest'
  const toolkitLibPackage = '@aws-cdk/toolkit-lib';
  let toolkitSource: IRunnerSource<ITestLibrarySource> | undefined;
  if (args['toolkit-lib-version']) {
    toolkitSource = new RunnerLibraryGlobalInstallSource(toolkitLibPackage, args['toolkit-lib-version']);
  }
  if (!toolkitSource) {
    toolkitSource = await RunnerLibraryPreinstalledSource.isPreinstalled(toolkitLibPackage)
      ? new RunnerLibraryPreinstalledSource(toolkitLibPackage)
      : new RunnerLibraryGlobalInstallSource(toolkitLibPackage, 'latest');
  }

  console.log('------> Configuration');
  console.log(`        Test suite:         ${suiteName}`);
  console.log(`        Test version:       ${thisPackageVersion()}`);
  console.log(`        CLI source:         ${cliSource.assert().sourceDescription}`);
  console.log(`        Library source:     ${librarySource.sourceDescription}`);
  console.log(`        Toolkit lib source: ${toolkitSource.sourceDescription}`);
  console.log(`        cdk-assets source:  ${cdkAssetsSource.assert().sourceDescription}`);

  if (args.verbose) {
    process.env.VERBOSE = '1';
  }

  // Motivation behind this behavior: when adding a new test suite to the pipeline, because of the way our
  // Pipeline package works, the suite would be added to the pipeline AND as a canary immediately. The canary
  // would fail until the package was actually released, so for canaries we make an exception so that the initial
  // canary would succeed even if the suite wasn't yet available. The fact that the suite is not optional in
  // the pipeline protects us from typos.
  const passWithNoTests = args.passWithNoTests ?? !!process.env.IS_CANARY;

  // Communicate with the config file (integ.jest.config.js)
  process.env.TEST_SUITE_NAME = suiteName;

  const disposables = new Array<{ dispose(): Promise<void> }>();
  try {
    console.log('------> Resolved versions');
    const cli = await cliSource.assert().runnerPrepare();
    disposables.push(cli);
    console.log(`        CLI:             ${cli.version}`);

    const library = await librarySource.runnerPrepare();
    disposables.push(library);
    console.log(`        Library:         ${library.version}`);

    const toolkitLib = await toolkitSource.runnerPrepare();
    disposables.push(toolkitLib);
    console.log(`        Toolkit library: ${toolkitLib.version}`);

    const cdkAssets = await cdkAssetsSource.assert().runnerPrepare();
    disposables.push(cdkAssets);
    console.log(`        cdk-assets:      ${cdkAssets.version}`);

    serializeSources({
      cli,
      library,
      toolkitLib,
      cdkAssets,
    });

    const jestConfig = path.resolve(__dirname, '..', '..', 'resources', 'integ.jest.config.js');

    await jest.run([
      '--randomize',
      ...args.runInBand ? ['-i'] : [],
      ...args.test ? ['-t', args.test] : [],
      ...args.verbose ? ['--verbose'] : [],
      ...args.maxWorkers ? [`--maxWorkers=${args.maxWorkers}`] : [],
      ...passWithNoTests ? ['--passWithNoTests'] : [],
      ...args['test-file'] ? [args['test-file']] : [],
    ], jestConfig);
  } finally {
    for (const disp of disposables) {
      await disp.dispose();
    }
  }
}

class UniqueOption<A> {
  public value: A | undefined;
  private source: string | undefined;

  constructor(private readonly what: string) {
  }

  public isSet() {
    return this.value !== undefined;
  }

  public assert(): A {
    if (!this.value) {
      throw new Error(`${this.what} not configured`);
    }
    return this.value;
  }

  public set(x: A, source: string) {
    if (this.value) {
      throw new Error(`${this.what}: ${source} already configured via ${this.source}`);
    }
    this.value = x;
    this.source = source;
  }
}

function thisPackageVersion(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../package.json').version;
}

main().catch(e => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exitCode = 1;
});
