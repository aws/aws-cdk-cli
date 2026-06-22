/* eslint-disable @cdklabs/no-literal-partition */
import * as path from 'path';
import { AVAILABILITY_ZONE_FALLBACK_CONTEXT_KEY } from '@aws-cdk/cloud-assembly-api';
import type { TestCase, DefaultCdkOptions } from '@aws-cdk/cloud-assembly-schema';
import * as fs from 'fs-extra';
import { IntegTestSuite, LegacyIntegTestSuite } from './integ-test-suite';
import type { IntegTest } from './integration-tests';
import * as recommendedFlagsFile from '../recommended-feature-flags.json';
import { flatten } from '../utils';
import { makeEngine } from './engine';
import type { ICdk } from '../engines/cdk-interface';
import * as logger from '../logger';
import type { ManifestTrace } from './private/cloud-assembly';
import { AssemblyManifestReader } from './private/cloud-assembly';
import type { DestructiveChange } from '../workers/common';
import { NoManifestError } from './private/integ-manifest';

const DESTRUCTIVE_CHANGES = '!!DESTRUCTIVE_CHANGES:';

/**
 * Options for creating an integ helper
 */
export interface CdkIntegHelperOptions {
  /**
   * Information about the test to run
   */
  readonly test: IntegTest;

  /**
   * The region where the test should be deployed
   */
  readonly region: string;

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
   * tmp cdk.out directory
   *
   * @default - directory will be `cdk-integ.out.${testName}`
   */
  readonly integOutDir?: string;

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
 */
export class CdkIntegHelper {
  /**
   * Factory method to create an instance of the CdkIntegHelper.
   *
   * Hiding the constructor to prevent inheritance.
   */
  public static create(options: CdkIntegHelperOptions) {
    return new CdkIntegHelper(options);
  }

  /**
   * The directory where the golden snapshot will be stored
   */
  public readonly goldenSnapshotDir: string;

  /**
   * An instance of the CDK  CLI
   */
  public readonly cdk: ICdk;

  /**
   * Pretty name of the test
   */
  public readonly testName: string;

  /**
   * The value used in the '--app' CLI parameter
   *
   * Path to the integ test source file, relative to `this.directory`.
   */
  public readonly cdkApp: string;

  /**
   * The path where the `cdk.context.json` file
   * will be created
   */
  public readonly cdkContextPath: string;

  /**
   * The working directory that the integration tests will be
   * executed from
   */
  public readonly directory: string;

  /**
   * The test to run
   */
  private readonly test: IntegTest;

  /**
   * Default options to pass to the CDK CLI
   */
  public readonly defaultArgs: DefaultCdkOptions = {
    pathMetadata: false,
    assetMetadata: false,
    versionReporting: false,
  };

  /**
   * The directory where the CDK will be synthed to
   *
   * Relative to cwd.
   */
  public readonly cdkOutDir: string;

  /**
   * The profile to use for the CDK CLI calls
   */
  public readonly profile?: string;

  /**
   * Show output from the integ test run.
   */
  private readonly showOutput: boolean;

  public _destructiveChanges?: DestructiveChange[];
  private legacyContext?: Record<string, any>;
  private _expectedTestSuite?: IntegTestSuite | LegacyIntegTestSuite;
  private _actualSnapshot?: SnapshotAndTestDefinition;
  private _legacyEnableLookups?: LegacyEnableLookups;

  /**
   * Private constructor to prevent inheritance.
   */
  private constructor(options: CdkIntegHelperOptions) {
    this.test = options.test;
    this.directory = this.test.directory;
    this.testName = this.test.testName;
    this.goldenSnapshotDir = this.test.snapshotDir;
    this.cdkContextPath = path.join(this.directory, 'cdk.context.json');
    this.profile = options.profile;
    this.showOutput = options.showOutput ?? false;

    this.cdk = options.cdk ?? makeEngine(options);
    this.cdkOutDir = options.integOutDir ?? this.test.temporaryOutputDir;

    const testRunCommand = this.test.appCommand;
    this.cdkApp = testRunCommand.replace('{filePath}', path.relative(this.directory, this.test.fileName));
  }

  /**
   * Configure the legacy enableLookups value to use when generating the actual snapshot.
   *
   * Must be set before using snapshot methods.
   */
  public configureLegacyEnableLookups(enableLookups: LegacyEnableLookups): void {
    this._legacyEnableLookups = enableLookups;
  }

  /**
   * Return the list of actual (i.e. new) test cases for this integration test
   */
  public async actualTests(): Promise<{ [testName: string]: TestCase } | undefined> {
    return (await this.actualTestSuite()).testSuite;
  }

  /**
   * Generate a new "actual" snapshot which will be compared to the
   * existing "expected" snapshot
   * This will synth and then load the integration test manifest
   */
  private async generateActualSnapshot(): Promise<SnapshotAndTestDefinition> {
    await this.synthActualSnapshot(this.cdkOutDir);
    const manifest = await this.loadManifest(this.cdkOutDir);
    return {
      testDefinition: manifest,
      snapshotDirectory: this.cdkOutDir,
    };
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
  private async synthActualSnapshot(outputDirectory: string): Promise<void> {
    if (this._legacyEnableLookups === undefined) {
      throw new Error('Must call configureLegacyEnableLookups before generating snapshots');
    }

    await this.cdk.synth({
      app: this.cdkApp,
      context: this.getContext(this._legacyEnableLookups !== false ? DEFAULT_SYNTH_OPTIONS.context : {}),
      env: DEFAULT_SYNTH_OPTIONS.env,
      output: path.relative(this.directory, outputDirectory),
    });
  }

  public actualSynthReproCommand() {
    // Show the command necessary to repro this
    const envSet = Object.entries(DEFAULT_SYNTH_OPTIONS.env).map(([k, v]) => `${k}='${v}'`);
    const envCmd = envSet.length > 0 ? ['env', ...envSet] : [];

    return [
      ...envCmd,
      'cdk',
      'synth',
      '-a',
      `'${this.cdkApp}'`,
      '-o',
      `'${this.cdkOutDir}'`,
      ...Object.entries(this.getContext(DEFAULT_SYNTH_OPTIONS.context)).flatMap(([k, v]) => typeof v !== 'object' ? [`-c '${k}=${v}'`] : []),
    ];
  }

  /**
   * Returns true if a snapshot already exists for this test
   */
  public hasSnapshot(): boolean {
    return fs.existsSync(this.goldenSnapshotDir);
  }

  /**
   * The test suite from the existing snapshot
   */
  public async expectedTestSuite(): Promise<IntegTestSuite | LegacyIntegTestSuite | undefined> {
    if (!this._expectedTestSuite && this.hasSnapshot()) {
      this._expectedTestSuite = await this.loadManifest();
    }
    return this._expectedTestSuite;
  }

  public async actualSnapshot(): Promise<SnapshotAndTestDefinition> {
    if (!this._actualSnapshot) {
      this._actualSnapshot = await this.generateActualSnapshot();

      // Check if the enableLookups value has changed between the golden
      // snapshot and the actual snapshot. If it has, we need to re-synth the
      // actual snapshot with the new enableLookups value.
      //
      // See `synthActualSnapshot` for a description of why this is necessary.
      const actualEnableLookups = this._actualSnapshot.testDefinition.enableLookups ?? false;
      if (actualEnableLookups !== this._legacyEnableLookups && this._legacyEnableLookups !== 'dont-care') {
        this.configureLegacyEnableLookups(actualEnableLookups);
        this._actualSnapshot = await this.generateActualSnapshot();
      }
    }
    return this._actualSnapshot;
  }

  /**
   * The test suite from the new "actual" snapshot
   */
  private async actualTestSuite(): Promise<IntegTestSuite | LegacyIntegTestSuite> {
    return (await this.actualSnapshot()).testDefinition;
  }

  /**
   * Load the integ manifest which contains information
   * on how to execute the tests
   * First we try and load the manifest from the integ manifest (i.e. integ.json)
   * from the cloud assembly. If it doesn't exist, then we fallback to the
   * "legacy mode" and create a manifest from pragma
   */
  public async loadManifest(dir?: string): Promise<IntegTestSuite | LegacyIntegTestSuite> {
    const manifest = dir ?? this.goldenSnapshotDir;
    try {
      const testSuite = IntegTestSuite.fromPath(manifest);
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
          manifest,
          modernError.message ?? String(modernError),
        );
      }

      const testCases = await LegacyIntegTestSuite.fromLegacy({
        cdk: this.cdk,
        testName: this.test.normalizedTestName,
        integSourceFilePath: this.test.fileName,
        listOptions: {
          ...this.defaultArgs,
          all: true,
          app: this.cdkApp,
          profile: this.profile,
          output: path.relative(this.directory, this.cdkOutDir),
        },
      });
      this.legacyContext = LegacyIntegTestSuite.getPragmaContext(this.test.fileName);
      return testCases;
    }
  }

  public cleanup(): void {
    const cdkOutPath = this.cdkOutDir;
    if (fs.existsSync(cdkOutPath)) {
      fs.removeSync(cdkOutPath);
    }
    // Clear cache
    this._actualSnapshot = undefined;
  }

  /**
   * If there are any destructive changes to a stack then this will record
   * those in the manifest.json file
   */
  private renderTraceData(): ManifestTrace {
    const traceData: ManifestTrace = new Map();
    const destructiveChanges = this._destructiveChanges ?? [];
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
    const stacks = (await this.actualTestSuite()).getStacksWithoutUpdateWorkflow() ?? [];
    const manifest = AssemblyManifestReader.fromPath(this.goldenSnapshotDir);
    const assets = flatten(stacks.map(stack => {
      return manifest.getAssetLocationsForStack(stack) ?? [];
    }));

    assets.forEach(asset => {
      const fileName = path.join(this.goldenSnapshotDir, asset);
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
    const files = fs.readdirSync(this.goldenSnapshotDir);
    files.forEach(file => {
      const fileName = path.join(this.goldenSnapshotDir, file);
      if (fs.lstatSync(fileName).isDirectory() && file === '.cache') {
        fs.emptyDirSync(fileName);
        fs.rmdirSync(fileName);
      }
    });
  }

  /**
   * Create the new snapshot.
   *
   * If lookups are enabled, then we need create the snapshot by synth'ing again
   * with the dummy context so that each time the test is run on different machines
   * (and with different context/env) the diff will not change.
   *
   * If lookups are disabled (which means the stack is env agnostic) then just copy
   * the assembly that was output by the deployment
   */
  public async createSnapshot(): Promise<void> {
    if (fs.existsSync(this.goldenSnapshotDir)) {
      fs.removeSync(this.goldenSnapshotDir);
    }

    // TODO: If we're clever, we should be able to reuse the snapshot that was
    // generated during the test invalidation check and avoid the below synth.
    // But that gets run in a completely different lifecycle and it might not
    // exist. We're not dealing with that just yet.
    await this.synthActualSnapshot(this.goldenSnapshotDir);

    await this.cleanupGoldenSnapshot();
  }

  /**
   * Perform some cleanup steps after the snapshot is created
   * Anytime the snapshot needs to be modified after creation
   * the logic should live here.
   */
  private async cleanupGoldenSnapshot(): Promise<void> {
    if (fs.existsSync(this.goldenSnapshotDir)) {
      await this.removeAssetsFromSnapshot();
      this.removeAssetsCacheFromSnapshot();
      const assembly = AssemblyManifestReader.fromPath(this.goldenSnapshotDir);
      assembly.cleanManifest();
      assembly.recordTrace(this.renderTraceData());
    }

    // if this is a legacy test then create an integ manifest
    // in the snapshot directory which can be used for the
    // update workflow. Save any legacyContext as well so that it can be read
    // the next time
    const actualTestSuite = await this.actualTestSuite();
    if (actualTestSuite.type === 'legacy-test-suite') {
      (actualTestSuite as LegacyIntegTestSuite).saveManifest(this.goldenSnapshotDir, this.legacyContext);
    }
  }

  public getContext(additionalContext?: Record<string, any>): Record<string, any> {
    return {
      ...currentlyRecommendedAwsCdkLibFlags(),
      ...this.legacyContext,
      ...additionalContext,

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

export interface SnapshotAndTestDefinition {
  readonly testDefinition: IntegTestSuite | LegacyIntegTestSuite;
  readonly snapshotDirectory: string;
}
