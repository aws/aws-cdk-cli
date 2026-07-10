/* eslint-disable @cdklabs/no-literal-partition */
import * as path from 'path';
import { AVAILABILITY_ZONE_FALLBACK_CONTEXT_KEY, UNKNOWN_REGION } from '@aws-cdk/cloud-assembly-api';
import { type TestCase, type DefaultCdkOptions, RequireApproval } from '@aws-cdk/cloud-assembly-schema';
import * as fs from 'fs-extra';
import { IntegTestSuite, LegacyIntegTestSuite } from './integ-test-suite';
import type { DeployOptions, DestroyOptions, ICdk, WatchEvents } from '../engines/cdk-interface';
import * as logger from '../logger';
import * as recommendedFlagsFile from '../recommended-feature-flags.json';
import { flatten } from '../utils';
import type { IntegTest } from './integration-tests';
import type { ManifestTrace } from './private/cloud-assembly';
import { AssemblyManifestReader } from './private/cloud-assembly';
import type { DestructiveChange } from '../workers/common';
import { NoManifestError } from './private/integ-manifest';
import { findTestSpecificContext, type CdkContext } from './private/test-specific-context';
import { ToolkitLibRunnerEngine } from '../engines/toolkit-lib';
import { absAwareJoin } from '../files';

const DESTRUCTIVE_CHANGES = '!!DESTRUCTIVE_CHANGES:';

/**
 * Options for creating a CDK Cloud Assembly
 */
export interface CdkTestAppOptions {
  readonly test: IntegTest;

  /**
   * The region where the test should be deployed
   */
  readonly region?: string;

  /**
   * The AWS profile to use when invoking the CDK CLI
   *
   * @default - no profile is passed, the default profile is used
   */
  readonly profile?: string;

  /**
   * Additional environment variables that will be available
   * to the CDK CLI
   *
   * @default - no additional environment variables
   */
  readonly env?: { [name: string]: string };

  /**
   * Where we will write the output of the CDK CLI, including the cloud assembly and the snapshot
   *
   * Should be a string containing `{testName}`, will be used to generate a directory name in the same
   * directory as the test itself.
   *
   * @default 'cdk-integ.out.{testName}.snapshot'
   */
  readonly outputDirectoryNameTemplate: string;

  /**
   * Instance of the CDK Toolkit Engine to use
   *
   * @default - based on `engine` option
   */
  readonly cdk?: ICdk;

  /**
   * Show output from running integration tests
   *
   * @default false
   */
  readonly showOutput?: boolean;

  /**
   * Use the indicated proxy
   *
   * @default - no proxy
   */
  readonly proxy?: string;

  /**
   * Path to CA certificate to use when validating HTTPS requests
   *
   * @default - no additional CA bundle
   */
  readonly caBundlePath?: string;

  /**
   * In unit test mode, we are using mocks for a lot of calls
   *
   * Don't delete directories, and don't do checks whether files actually exist; the
   * mocks will be there to produce the contents for files that are being read (although
   * they are not there to pretend to have files themselves).
   */
  readonly TESTING_usingMocks?: boolean;

  /**
   * We will only read the legacy test information if the test actually produced an output directory.
   *
   * For historical reasons the tests have been written so that they will expect to read
   * legacy test information always. Force that behavior back for tests.
   */
  readonly TESTING_forceReadLegacyTestSuite?: boolean;
}

/**
 * Whether to synthesize the actual snapshot with lookups enabled or not.
 *
 * If either `true` or `false`, we send context in or not while synthesizing,
 * and if the generated snapshot test definition requests a different value we
 * will synth again.
 *
 * For `dont-care`, we do send in the context but we never resynth.
 */
export type LegacyEnableLookups = true | false | 'dont-care';

/**
 * Class with some helper routines for running CDK snapshots and integration tests.
 *
 * A "golden snapshot" is the snapshot that is stored permanently in version
 * control, that new runs are compared against (stored in a directory named
 * `<test-name>.snapshot`).
 *
 * This is as opposed to other snapshots, which can be generated for example
 * temporarily in a temporary directory, to compare agains the golden snapshot.
 */
export class CdkTestApp {
  public static async forGoldenSnapshot(options: Omit<CdkTestAppOptions, 'outputDirectoryNameTemplate'>): Promise<CdkTestApp> {
    return CdkTestApp.create({
      ...options,
      outputDirectoryNameTemplate: '{testBaseName}.snapshot',
    });
  }

  public static async forComparison(options: Omit<CdkTestAppOptions, 'outputDirectoryNameTemplate'>): Promise<CdkTestApp> {
    return CdkTestApp.create({
      ...options,
      outputDirectoryNameTemplate: 'cdk-integ.out.{testBaseName}.snapshot',
    });
  }

  public static async forSpecificDirectory(options: CdkTestAppOptions): Promise<CdkTestApp> {
    return CdkTestApp.create(options);
  }

  public static async forDeployment(options: Omit<CdkTestAppOptions, 'outputDirectoryNameTemplate'>): Promise<CdkTestApp> {
    return CdkTestApp.create({
      ...options,
      outputDirectoryNameTemplate: 'cdk-integ.out.deploy.{testBaseName}.snapshot',
    });
  }

  private static async create(options: CdkTestAppOptions): Promise<CdkTestApp> {
    const ctx = await findTestSpecificContext(options.test.absoluteFileName);
    const app = new CdkTestApp(options, ctx);
    return app;
  }

  /**
   * An instance of the CDK  CLI
   */
  private readonly cdk: ICdk;

  public readonly outputDirectory: string;

  /**
   * Default options to pass to the CDK CLI
   */
  private readonly defaultArgs: DefaultCdkOptions = {
    pathMetadata: false,
    assetMetadata: false,
    versionReporting: false,
  };

  /**
   * The profile to use for the CDK CLI calls
   */
  public readonly profile?: string;

  /**
   * Show output from the integ test run.
   */
  private readonly showOutput: boolean;

  public readonly test: IntegTest;

  public synthReproCommand: string = '';

  public _destructiveChanges?: DestructiveChange[];
  private legacyContext?: Record<string, any>;
  private _testSuite?: IntegTestSuite | LegacyIntegTestSuite;
  private _legacyEnableLookups?: LegacyEnableLookups;

  public readonly appCommand: string;
  private hasValidRegion: boolean;

  private constructor(private readonly options: CdkTestAppOptions, private readonly testSpecificContext?: CdkContext) {
    this.hasValidRegion = options.region !== UNKNOWN_REGION;

    this.test = options.test;

    const outputDirectoryNameTemplate = options.outputDirectoryNameTemplate;
    this.outputDirectory = absAwareJoin(this.test.testDirectory, this.test.specializeTemplate(outputDirectoryNameTemplate));

    this.profile = options.profile;
    this.showOutput = options.showOutput ?? false;

    this.cdk = options.cdk ?? new ToolkitLibRunnerEngine({
      workingDirectory: this.test.workingDirectory,
      showOutput: options.showOutput,
      env: options.env,
      region: options.region,
      profile: options.profile,
      proxy: options.proxy,
      caBundlePath: options.caBundlePath,
    });

    this.appCommand = this.test.specializeTemplate(this.test.appCommandTemplate);
  }

  /**
   * Configure the legacy enableLookups value to use when generating the actual snapshot.
   *
   * Must be set before using snapshot methods.
   */
  public configureLegacyEnableLookups(enableLookups: LegacyEnableLookups): void {
    this._legacyEnableLookups = enableLookups;
  }

  public async hasOutput() {
    return (await fs.pathExists(this.outputDirectory)) && (await fs.pathExists(path.join(this.outputDirectory, 'manifest.json')));
  }

  /**
   * Return the test cases inside the output
   */
  public testCases(): { [testName: string]: TestCase } {
    return this.testSuite.testSuite;
  }

  /**
   * The test suite from the output
   */
  public get testSuite(): IntegTestSuite | LegacyIntegTestSuite {
    if (!this._testSuite) {
      throw new Error('Synthesize first!');
    }

    return this._testSuite;
  }

  /**
   * If the snapshot already exists, load it
   */
  public async loadExistingSuite(): Promise<IntegTestSuite | LegacyIntegTestSuite | undefined> {
    if (this._testSuite) {
      return this._testSuite;
    }

    if (await this.hasOutput()) {
      this._testSuite = await this._loadManifest();
      return this._testSuite;
    }

    if (this.options.TESTING_forceReadLegacyTestSuite) {
      return this._loadLegacyTestSuite();
    }

    return undefined;
  }

  public async synthForSnapshotComparison(enableLookupsGuess: LegacyEnableLookups) {
    this.configureLegacyEnableLookups(enableLookupsGuess);
    const suite = await this.synth(this.getContext('snapshot'), DEFAULT_SYNTH_OPTIONS.env);

    // Check if the enableLookups value has changed between the golden
    // snapshot and the actual snapshot. If it has, we need to re-synth the
    // actual snapshot with the new enableLookups value.
    //
    // See `synthActualSnapshot` for a description of why this is necessary.
    const actualEnableLookups = suite.enableLookups ?? false;
    if (actualEnableLookups !== this._legacyEnableLookups && this._legacyEnableLookups !== 'dont-care') {
      this.configureLegacyEnableLookups(actualEnableLookups);
      return this.synth(this.getContext('snapshot'), DEFAULT_SYNTH_OPTIONS.env);
    }
    return suite;
  }

  public async synthForGoldenSnapshot(destructiveChanges: DestructiveChange[], enableLookups: LegacyEnableLookups) {
    this.configureLegacyEnableLookups(enableLookups);
    await this.synth(this.getContext('snapshot'), DEFAULT_SYNTH_OPTIONS.env);
    await this.cleanupGoldenSnapshot(destructiveChanges);
    return this.testSuite;
  }

  public async synthForDeployment() {
    this.configureLegacyEnableLookups('dont-care');
    await this.synth(this.getContext('deployment'), {});
    return this.testSuite;
  }

  /**
   * For a given cloud assembly return a collection of all templates
   * that should be part of the snapshot and any required meta data.
   *
   * @param cloudAssemblyDir - The directory of the cloud assembly to look for snapshots
   * @param pickStacks - Pick only these stacks from the cloud assembly
   * @returns A SnapshotAssembly, the collection of all templates in this snapshot and required meta data
   */
  public snapshotAssembly(pickStacks: string[] = []): SnapshotAssembly {
    const assembly = this.readAssembly(this.outputDirectory);
    const stacks = assembly.stacks;
    const snapshots: SnapshotAssembly = {};
    for (const [stackName, stackTemplate] of Object.entries(stacks)) {
      if (pickStacks.includes(stackName)) {
        const manifest = AssemblyManifestReader.fromPath(this.outputDirectory);
        const assets = manifest.getAssetIdsForStack(stackName);

        snapshots[stackName] = {
          templates: {
            [stackName]: stackTemplate,
            ...assembly.getNestedStacksForStack(stackName),
          },
          assets,
        };
      }
    }

    return snapshots;
  }

  private readAssembly(dir: string): AssemblyManifestReader {
    return AssemblyManifestReader.fromPath(dir);
  }

  /**
   * Synth the actual application to the given directory, for purposes of generating/validating a snapshot
   *
   * `legacyEnableLookups` is to preserve historical behavior for a while:
   * traditionally, the application would only be seeded with context if
   * `enableLookups` was true, and this information would come from the test
   * definition.
   *
   * - Since the test definition comes from inside the app, this requires a
   *   synth just to get the test definition, and then another synth to generate
   *   the actual snapshot with the correct context, which is time consuming.
   * - Given that the context is fixed and fake, it could always have been passed.
   *
   * However, the snapshot contents themselves depend on the context flag, and changing
   * this behavior now invalidates all snapshots everywhere, which is annoying for upgrading.
   *
   * So we will use the behavior from the GOLDEN SNAPSHOT's test definition to
   * determine whether to pass the context, and if the new actual snapshot has a
   * different value for `enableLookups`, we will throw away the old snapshot and synth again.
   */
  private async synth(context: Record<string, any>, env: Record<string, string>): Promise<IntegTestSuite | LegacyIntegTestSuite> {
    const output = this.outputDirectory;

    // Remove the target directory, so that we don't have stale files from
    // previous synths. Also, the runner will re-use a directory that already
    // exists and we want force recreation (unless we are unit testing).
    if (!this.options.TESTING_usingMocks) {
      await fs.rm(output, { recursive: true, force: true });
    }

    await this.cdk.synth({
      app: this.appCommand,
      context,
      env,
      output,
    });

    this.setReproCommand(context, env);

    this._testSuite = await this._loadManifest();
    return this._testSuite;
  }

  public async deploy(deployArgs: Omit<DeployOptions, 'app' | 'requireApproval' | 'profile' | 'output' | 'lookups'>) {
    if (!this.hasValidRegion) {
      throw new Error('CdkTestApp.deploy: not initialized with a valid region');
    }

    return this.cdk.deploy({
      ...DEFAULT_ARGS,
      ...deployArgs,
      output: this.outputDirectory,
      profile: this.profile,
      requireApproval: RequireApproval.NEVER,
      app: this.appCommand,
      context: {
        ...this.getContext('deployment'),
        ...deployArgs?.context,
      },
    });
  }

  public async destroy(destroyArgs: Omit<DestroyOptions, 'app' | 'force' | 'profile' | 'output'>) {
    if (!this.hasValidRegion) {
      throw new Error('CdkTestApp.destroy: not initialized with a valid region');
    }

    await this.cdk.destroy({
      ...DEFAULT_ARGS,
      ...destroyArgs,
      app: this.appCommand,
      output: this.outputDirectory,
      profile: this.profile,
      force: true,
      context: {
        ...this.getContext('deployment'),
        ...destroyArgs?.context,
      },
    });
  }

  public async watch(watchArgs: Omit<DeployOptions, 'app' | 'requireApproval' | 'profile' | 'output' | 'lookups'>, watchEvents: WatchEvents) {
    if (!this.hasValidRegion) {
      throw new Error('CdkTestApp.watch: not initialized with a valid region');
    }

    await this.cdk.watch({
      ...DEFAULT_ARGS,
      ...watchArgs,
      output: this.outputDirectory,
      profile: this.profile,
      requireApproval: RequireApproval.NEVER,
      app: this.appCommand,
      context: {
        ...this.getContext('deployment'),
        ...watchArgs?.context,
      },
    }, watchEvents);
  }

  private setReproCommand(context: Record<string, any>, env: Record<string, string>) {
    // Show the command necessary to repro this
    const envSet = Object.entries(env).map(([k, v]) => `${k}='${v}'`);
    const envCmd = envSet.length > 0 ? ['env', ...envSet] : [];

    this.synthReproCommand = [
      ...envCmd,
      'cdk',
      'synth',
      '-a',
      `'${this.appCommand}'`,
      '-o',
      `'${this.outputDirectory}'`,
      ...Object.entries(context).flatMap(([k, v]) => typeof v !== 'object' ? [`-c '${k}=${v}'`] : []),
    ].join(' ');
  }

  /**
   * Load the integ manifest which contains information
   * on how to execute the tests
   * First we try and load the manifest from the integ manifest (i.e. integ.json)
   * from the cloud assembly. If it doesn't exist, then we fallback to the
   * "legacy mode" and create a manifest from pragma
   *
   * @internal
   */
  private async _loadManifest(): Promise<IntegTestSuite | LegacyIntegTestSuite> {
    if (!await this.hasOutput() && !this.options.TESTING_usingMocks) {
      throw new Error(`Synth did not produce output directory: ${this.outputDirectory}`);
    }
    const manifestDir = this.outputDirectory;
    try {
      const testSuite = IntegTestSuite.fromPath(manifestDir);
      return testSuite;
    } catch (modernError: any) {
      // Only attempt legacy test case if the integ test manifest was not found
      // For any other errors, e.g. when parsing the manifest fails, we abort.
      if (!(modernError instanceof NoManifestError)) {
        throw modernError;
      }

      if (this.showOutput) {
        logger.trace(
          "Failed to load integ test manifest for '%s'. Attempting as deprecated legacy test instead. Error was: %s",
          manifestDir,
          modernError.message ?? String(modernError),
        );
      }

      return this._loadLegacyTestSuite();
    }
  }

  private async _loadLegacyTestSuite(): Promise<LegacyIntegTestSuite> {
    const testCases = await LegacyIntegTestSuite.fromLegacy({
      cdk: this.cdk,
      testName: this.test.normalizedTestName,
      integSourceFilePath: this.test.fileName,
      listOptions: {
        ...this.defaultArgs,
        all: true,
        app: this.appCommand,
        profile: this.profile,
        output: this.outputDirectory,
      },
    });
    this.legacyContext = LegacyIntegTestSuite.getPragmaContext(this.test.fileName);
    return testCases;
  }

  public cleanup(): void {
    const cdkOutPath = this.outputDirectory;
    if (fs.existsSync(cdkOutPath)) {
      fs.removeSync(cdkOutPath);
    }
    // Clear cache
    this._testSuite = undefined;
  }

  /**
   * If there are any destructive changes to a stack then this will record
   * those in the manifest.json file
   */
  private renderTraceData(destructiveChanges: DestructiveChange[]): ManifestTrace {
    const traceData: ManifestTrace = new Map();
    destructiveChanges.forEach(change => {
      const trace = traceData.get(change.stackName);
      if (trace) {
        trace.set(change.logicalId, `${DESTRUCTIVE_CHANGES} ${change.impact}`);
      } else {
        traceData.set(change.stackName, new Map([
          [change.logicalId, `${DESTRUCTIVE_CHANGES} ${change.impact}`],
        ]));
      }
    });
    return traceData;
  }

  /**
   * In cases where we do not want to retain the assets,
   * for example, if the assets are very large.
   *
   * Since it is possible to disable the update workflow for individual test
   * cases, this needs to first get a list of stacks that have the update workflow
   * disabled and then delete assets that relate to that stack. It does that
   * by reading the asset manifest for the stack and deleting the asset source
   */
  private async removeAssetsFromSnapshot(): Promise<void> {
    const stacks = this.testSuite.getStacksWithoutUpdateWorkflow() ?? [];
    const manifest = AssemblyManifestReader.fromPath(this.outputDirectory);
    const assets = flatten(stacks.map(stack => {
      return manifest.getAssetLocationsForStack(stack) ?? [];
    }));

    assets.forEach(asset => {
      const fileName = path.join(this.outputDirectory, asset);
      if (fs.existsSync(fileName)) {
        if (fs.lstatSync(fileName).isDirectory()) {
          fs.removeSync(fileName);
        } else {
          fs.unlinkSync(fileName);
        }
      }
    });
  }

  /**
   * Remove the asset cache (.cache/) files from the snapshot.
   * These are a cache of the asset zips, but we are fine with
   * re-zipping on deploy
   */
  private removeAssetsCacheFromSnapshot(): void {
    const files = fs.readdirSync(this.outputDirectory);
    files.forEach(file => {
      const fileName = path.join(this.outputDirectory, file);
      if (fs.lstatSync(fileName).isDirectory() && file === '.cache') {
        fs.emptyDirSync(fileName);
        fs.rmdirSync(fileName);
      }
    });
  }

  /**
   * Perform some cleanup steps after the snapshot is created
   * Anytime the snapshot needs to be modified after creation
   * the logic should live here.
   */
  private async cleanupGoldenSnapshot(destructiveChanges: DestructiveChange[]): Promise<void> {
    await this.removeAssetsFromSnapshot();
    this.removeAssetsCacheFromSnapshot();
    const assembly = AssemblyManifestReader.fromPath(this.outputDirectory);
    assembly.cleanManifest();
    assembly.recordTrace(this.renderTraceData(destructiveChanges));

    // if this is a legacy test then create an integ manifest
    // in the snapshot directory which can be used for the
    // update workflow. Save any legacyContext as well so that it can be read
    // the next time
    const actualTestSuite = this.testSuite;
    actualTestSuite.enableLookups = true;

    if (actualTestSuite instanceof LegacyIntegTestSuite) {
      actualTestSuite.saveManifest(this.outputDirectory, this.legacyContext);
    } else if (actualTestSuite instanceof IntegTestSuite) {
      actualTestSuite.saveManifest(this.outputDirectory);
    }
  }

  private getContext(forSnapshot: 'snapshot' | 'deployment'): Record<string, any> {
    if (this._legacyEnableLookups === undefined) {
      throw new Error('Must call configureLegacyEnableLookups before synthing');
    }
    // Load the test-specific context (from `integ.context.json` or `cdk.json#context`), if any.
    // If not found, use the built-in current feature flags (at the risk of newer feature flags changing
    // the snapshots).
    const featureFlags = this.testSpecificContext ?? currentlyRecommendedAwsCdkLibFlags();

    return {
      ...featureFlags,
      ...this.legacyContext,

      // The _legacyEnableLookups flag is crazy but is only there to not disturb existing snapshots too much.
      ...(forSnapshot === 'snapshot' && this._legacyEnableLookups !== false ? DEFAULT_SYNTH_OPTIONS.context : {}),

      // Don't record creation stack traces in the snapshot, since they just take up space and are never deterministic.
      'aws:cdk:disable-creation-stack-traces': true,

      // We originally had PLANNED to set this to ['aws', 'aws-cn'], but due to a programming mistake
      // it was set to everything. In this PR, set it to everything to not mess up all the snapshots.
      '@aws-cdk/core:target-partitions': undefined,

      /* ---------------- THE FUTURE LIVES BELOW----------------------------
      // Restricting to these target partitions makes most service principals synthesize to
      // `service.${URL_SUFFIX}`, which is technically *incorrect* (it's only `amazonaws.com`
      // or `amazonaws.com.cn`, never UrlSuffix for any of the restricted regions) but it's what
      // most existing integ tests contain, and we want to disturb as few as possible.
      // [TARGET_PARTITIONS]: ['aws', 'aws-cn'],
      /* ---------------- END OF THE FUTURE ------------------------------- */
    };
  }
}

// Default context we run all integ tests with, so they don't depend on the
// account of the exercising user.
export const DEFAULT_SYNTH_OPTIONS = {
  context: {
    // We have traditionally set this, but it's quite a bad idea. It makes region-agnostic stacks undeployable, and there's really no reason for that.
    // However, if we unset this, we will break many existing snapshots so we keep it for now.
    [AVAILABILITY_ZONE_FALLBACK_CONTEXT_KEY]: ['test-region-1a', 'test-region-1b', 'test-region-1c'],
    'availability-zones:account=12345678:region=test-region': ['test-region-1a', 'test-region-1b', 'test-region-1c'],
    'ssm:account=12345678:parameterName=/aws/service/ami-amazon-linux-latest/amzn-ami-hvm-x86_64-gp2:region=test-region': 'ami-1234',
    'ssm:account=12345678:parameterName=/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2:region=test-region': 'ami-1234',
    'ssm:account=12345678:parameterName=/aws/service/ecs/optimized-ami/amazon-linux/recommended:region=test-region': '{"image_id": "ami-1234"}',
    // eslint-disable-next-line @stylistic/max-len
    'ami:account=12345678:filters.image-type.0=machine:filters.name.0=amzn-ami-vpc-nat-*:filters.state.0=available:owners.0=amazon:region=test-region': 'ami-1234',
    'vpc-provider:account=12345678:filter.isDefault=true:region=test-region:returnAsymmetricSubnets=true': {
      vpcId: 'vpc-60900905',
      subnetGroups: [
        {
          type: 'Public',
          name: 'Public',
          subnets: [
            {
              subnetId: 'subnet-e19455ca',
              availabilityZone: 'us-east-1a',
              routeTableId: 'rtb-e19455ca',
            },
            {
              subnetId: 'subnet-e0c24797',
              availabilityZone: 'us-east-1b',
              routeTableId: 'rtb-e0c24797',
            },
            {
              subnetId: 'subnet-ccd77395',
              availabilityZone: 'us-east-1c',
              routeTableId: 'rtb-ccd77395',
            },
          ],
        },
      ],
    },
  },
  env: {
    CDK_INTEG_ACCOUNT: '12345678',
    CDK_INTEG_REGION: 'test-region',
    CDK_INTEG_HOSTED_ZONE_ID: 'Z23ABC4XYZL05B',
    CDK_INTEG_HOSTED_ZONE_NAME: 'example.com',
    CDK_INTEG_DOMAIN_NAME: '*.example.com',
    CDK_INTEG_CERT_ARN: 'arn:aws:acm:test-region:12345678:certificate/86468209-a272-595d-b831-0efb6421265z',
    CDK_INTEG_SUBNET_ID: 'subnet-0dff1a399d8f6f92c',
  },
};

/**
 * Return the currently recommended flags for `aws-cdk-lib`.
 *
 * These have been built into the CLI at build time. If this ever gets changed
 * back to a dynamic load, remember that this source file may be bundled into
 * a JavaScript bundle, and `__dirname` might not point where you think it does.
 */
export function currentlyRecommendedAwsCdkLibFlags() {
  return recommendedFlagsFile;
}

export interface SnapshotAssembly {
  /**
   * Map of stacks that are part of this assembly
   */
  [stackName: string]: {
    /**
     * All templates for this stack, including nested stacks
     */
    templates: {
      [templateId: string]: any;
    };

    /**
     * List of asset Ids that are used by this assembly
     */
    assets: string[];
  };
}

/**
 * Default options to pass to the CDK CLI
 */
export const DEFAULT_ARGS: DefaultCdkOptions = {
  pathMetadata: false,
  assetMetadata: false,
  versionReporting: false,
};
