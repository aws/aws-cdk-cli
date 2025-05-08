"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SYNTH_OPTIONS = exports.IntegRunner = void 0;
exports.currentlyRecommendedAwsCdkLibFlags = currentlyRecommendedAwsCdkLibFlags;
/* eslint-disable @cdklabs/no-literal-partition */
const path = require("path");
const cdk_cli_wrapper_1 = require("@aws-cdk/cdk-cli-wrapper");
const cx_api_1 = require("@aws-cdk/cx-api");
const fs = require("fs-extra");
const integ_test_suite_1 = require("./integ-test-suite");
const recommendedFlagsFile = require("../recommended-feature-flags.json");
const utils_1 = require("../utils");
const cloud_assembly_1 = require("./private/cloud-assembly");
const DESTRUCTIVE_CHANGES = '!!DESTRUCTIVE_CHANGES:';
/**
 * The different components of a test name
 */
/**
 * Represents an Integration test runner
 */
class IntegRunner {
    constructor(options) {
        /**
         * Default options to pass to the CDK CLI
         */
        this.defaultArgs = {
            pathMetadata: false,
            assetMetadata: false,
            versionReporting: false,
        };
        this.test = options.test;
        this.directory = this.test.directory;
        this.testName = this.test.testName;
        this.snapshotDir = this.test.snapshotDir;
        this.cdkContextPath = path.join(this.directory, 'cdk.context.json');
        this.cdk = options.cdk ?? new cdk_cli_wrapper_1.CdkCliWrapper({
            directory: this.directory,
            showOutput: options.showOutput,
            env: {
                ...options.env,
            },
        });
        this.cdkOutDir = options.integOutDir ?? this.test.temporaryOutputDir;
        const testRunCommand = this.test.appCommand;
        this.cdkApp = testRunCommand.replace('{filePath}', path.relative(this.directory, this.test.fileName));
        this.profile = options.profile;
        if (this.hasSnapshot()) {
            this.expectedTestSuite = this.loadManifest();
        }
        this.actualTestSuite = this.generateActualSnapshot();
    }
    /**
     * Return the list of expected (i.e. existing) test cases for this integration test
     */
    expectedTests() {
        return this.expectedTestSuite?.testSuite;
    }
    /**
     * Return the list of actual (i.e. new) test cases for this integration test
     */
    actualTests() {
        return this.actualTestSuite.testSuite;
    }
    /**
     * Generate a new "actual" snapshot which will be compared to the
     * existing "expected" snapshot
     * This will synth and then load the integration test manifest
     */
    generateActualSnapshot() {
        this.cdk.synthFast({
            execCmd: this.cdkApp.split(' '),
            env: {
                ...exports.DEFAULT_SYNTH_OPTIONS.env,
                // we don't know the "actual" context yet (this method is what generates it) so just
                // use the "expected" context. This is only run in order to read the manifest
                CDK_CONTEXT_JSON: JSON.stringify(this.getContext(this.expectedTestSuite?.synthContext)),
            },
            output: path.relative(this.directory, this.cdkOutDir),
        });
        const manifest = this.loadManifest(this.cdkOutDir);
        // after we load the manifest remove the tmp snapshot
        // so that it doesn't mess up the real snapshot created later
        this.cleanup();
        return manifest;
    }
    /**
     * Returns true if a snapshot already exists for this test
     */
    hasSnapshot() {
        return fs.existsSync(this.snapshotDir);
    }
    /**
     * Load the integ manifest which contains information
     * on how to execute the tests
     * First we try and load the manifest from the integ manifest (i.e. integ.json)
     * from the cloud assembly. If it doesn't exist, then we fallback to the
     * "legacy mode" and create a manifest from pragma
     */
    loadManifest(dir) {
        try {
            const testSuite = integ_test_suite_1.IntegTestSuite.fromPath(dir ?? this.snapshotDir);
            return testSuite;
        }
        catch {
            const testCases = integ_test_suite_1.LegacyIntegTestSuite.fromLegacy({
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
            this.legacyContext = integ_test_suite_1.LegacyIntegTestSuite.getPragmaContext(this.test.fileName);
            this.isLegacyTest = true;
            return testCases;
        }
    }
    cleanup() {
        const cdkOutPath = this.cdkOutDir;
        if (fs.existsSync(cdkOutPath)) {
            fs.removeSync(cdkOutPath);
        }
    }
    /**
     * If there are any destructive changes to a stack then this will record
     * those in the manifest.json file
     */
    renderTraceData() {
        const traceData = new Map();
        const destructiveChanges = this._destructiveChanges ?? [];
        destructiveChanges.forEach(change => {
            const trace = traceData.get(change.stackName);
            if (trace) {
                trace.set(change.logicalId, `${DESTRUCTIVE_CHANGES} ${change.impact}`);
            }
            else {
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
    removeAssetsFromSnapshot() {
        const stacks = this.actualTestSuite.getStacksWithoutUpdateWorkflow() ?? [];
        const manifest = cloud_assembly_1.AssemblyManifestReader.fromPath(this.snapshotDir);
        const assets = (0, utils_1.flatten)(stacks.map(stack => {
            return manifest.getAssetLocationsForStack(stack) ?? [];
        }));
        assets.forEach(asset => {
            const fileName = path.join(this.snapshotDir, asset);
            if (fs.existsSync(fileName)) {
                if (fs.lstatSync(fileName).isDirectory()) {
                    fs.removeSync(fileName);
                }
                else {
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
    removeAssetsCacheFromSnapshot() {
        const files = fs.readdirSync(this.snapshotDir);
        files.forEach(file => {
            const fileName = path.join(this.snapshotDir, file);
            if (fs.lstatSync(fileName).isDirectory() && file === '.cache') {
                fs.emptyDirSync(fileName);
                fs.rmdirSync(fileName);
            }
        });
    }
    /**
     * Create the new snapshot.
     *
     * If lookups are enabled, then we need create the snapshot by synthing again
     * with the dummy context so that each time the test is run on different machines
     * (and with different context/env) the diff will not change.
     *
     * If lookups are disabled (which means the stack is env agnostic) then just copy
     * the assembly that was output by the deployment
     */
    createSnapshot() {
        if (fs.existsSync(this.snapshotDir)) {
            fs.removeSync(this.snapshotDir);
        }
        // if lookups are enabled then we need to synth again
        // using dummy context and save that as the snapshot
        if (this.actualTestSuite.enableLookups) {
            this.cdk.synthFast({
                execCmd: this.cdkApp.split(' '),
                env: {
                    ...exports.DEFAULT_SYNTH_OPTIONS.env,
                    CDK_CONTEXT_JSON: JSON.stringify(this.getContext(exports.DEFAULT_SYNTH_OPTIONS.context)),
                },
                output: path.relative(this.directory, this.snapshotDir),
            });
        }
        else {
            fs.moveSync(this.cdkOutDir, this.snapshotDir, { overwrite: true });
        }
        this.cleanupSnapshot();
    }
    /**
     * Perform some cleanup steps after the snapshot is created
     * Anytime the snapshot needs to be modified after creation
     * the logic should live here.
     */
    cleanupSnapshot() {
        if (fs.existsSync(this.snapshotDir)) {
            this.removeAssetsFromSnapshot();
            this.removeAssetsCacheFromSnapshot();
            const assembly = cloud_assembly_1.AssemblyManifestReader.fromPath(this.snapshotDir);
            assembly.cleanManifest();
            assembly.recordTrace(this.renderTraceData());
        }
        // if this is a legacy test then create an integ manifest
        // in the snapshot directory which can be used for the
        // update workflow. Save any legacyContext as well so that it can be read
        // the next time
        if (this.actualTestSuite.type === 'legacy-test-suite') {
            this.actualTestSuite.saveManifest(this.snapshotDir, this.legacyContext);
        }
    }
    getContext(additionalContext) {
        return {
            ...currentlyRecommendedAwsCdkLibFlags(),
            ...this.legacyContext,
            ...additionalContext,
            // We originally had PLANNED to set this to ['aws', 'aws-cn'], but due to a programming mistake
            // it was set to everything. In this PR, set it to everything to not mess up all the snapshots.
            [cx_api_1.TARGET_PARTITIONS]: undefined,
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
exports.IntegRunner = IntegRunner;
// Default context we run all integ tests with, so they don't depend on the
// account of the exercising user.
exports.DEFAULT_SYNTH_OPTIONS = {
    context: {
        [cx_api_1.AVAILABILITY_ZONE_FALLBACK_CONTEXT_KEY]: ['test-region-1a', 'test-region-1b', 'test-region-1c'],
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
function currentlyRecommendedAwsCdkLibFlags() {
    return recommendedFlagsFile;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVubmVyLWJhc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJydW5uZXItYmFzZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUE2YkEsZ0ZBRUM7QUEvYkQsa0RBQWtEO0FBQ2xELDZCQUE2QjtBQUU3Qiw4REFBeUQ7QUFFekQsNENBQTRGO0FBQzVGLCtCQUErQjtBQUMvQix5REFBMEU7QUFFMUUsMEVBQTBFO0FBQzFFLG9DQUFtQztBQUVuQyw2REFBa0U7QUFHbEUsTUFBTSxtQkFBbUIsR0FBRyx3QkFBd0IsQ0FBQztBQWdEckQ7O0dBRUc7QUFDSDs7R0FFRztBQUNILE1BQXNCLFdBQVc7SUF3RS9CLFlBQVksT0FBMkI7UUF0QnZDOztXQUVHO1FBQ2dCLGdCQUFXLEdBQXNCO1lBQ2xELFlBQVksRUFBRSxLQUFLO1lBQ25CLGFBQWEsRUFBRSxLQUFLO1lBQ3BCLGdCQUFnQixFQUFFLEtBQUs7U0FDeEIsQ0FBQztRQWdCQSxJQUFJLENBQUMsSUFBSSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUM7UUFDekIsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQztRQUNyQyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDO1FBQ25DLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUM7UUFDekMsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsa0JBQWtCLENBQUMsQ0FBQztRQUVwRSxJQUFJLENBQUMsR0FBRyxHQUFHLE9BQU8sQ0FBQyxHQUFHLElBQUksSUFBSSwrQkFBYSxDQUFDO1lBQzFDLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztZQUN6QixVQUFVLEVBQUUsT0FBTyxDQUFDLFVBQVU7WUFDOUIsR0FBRyxFQUFFO2dCQUNILEdBQUcsT0FBTyxDQUFDLEdBQUc7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dGVudCI6WyIvKiBlc2xpbnQtZGlzYWJsZSBAY2RrbGFicy9uby1saXRlcmFsLXBhcnRpdGlvbiAqL1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB0eXBlIHsgSUNkayB9IGZyb20gJ0Bhd3MtY2RrL2Nkay1jbGktd3JhcHBlcic7XG5pbXBvcnQgeyBDZGtDbGlXcmFwcGVyIH0gZnJvbSAnQGF3cy1jZGsvY2RrLWNsaS13cmFwcGVyJztcbmltcG9ydCB0eXBlIHsgVGVzdENhc2UsIERlZmF1bHRDZGtPcHRpb25zIH0gZnJvbSAnQGF3cy1jZGsvY2xvdWQtYXNzZW1ibHktc2NoZW1hJztcbmltcG9ydCB7IEFWQUlMQUJJTElUWV9aT05FX0ZBTExCQUNLX0NPTlRFWFRfS0VZLCBUQVJHRVRfUEFSVElUSU9OUyB9IGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcy1leHRyYSc7XG5pbXBvcnQgeyBJbnRlZ1Rlc3RTdWl0ZSwgTGVnYWN5SW50ZWdUZXN0U3VpdGUgfSBmcm9tICcuL2ludGVnLXRlc3Qtc3VpdGUnO1xuaW1wb3J0IHR5cGUgeyBJbnRlZ1Rlc3QgfSBmcm9tICcuL2ludGVncmF0aW9uLXRlc3RzJztcbmltcG9ydCAqIGFzIHJlY29tbWVuZGVkRmxhZ3NGaWxlIGZyb20gJy4uL3JlY29tbWVuZGVkLWZlYXR1cmUtZmxhZ3MuanNvbic7XG5pbXBvcnQgeyBmbGF0dGVuIH0gZnJvbSAnLi4vdXRpbHMnO1xuaW1wb3J0IHR5cGUgeyBNYW5pZmVzdFRyYWNlIH0gZnJvbSAnLi9wcml2YXRlL2Nsb3VkLWFzc2VtYmx5JztcbmltcG9ydCB7IEFzc2VtYmx5TWFuaWZlc3RSZWFkZXIgfSBmcm9tICcuL3ByaXZhdGUvY2xvdWQtYXNzZW1ibHknO1xuaW1wb3J0IHR5cGUgeyBEZXN0cnVjdGl2ZUNoYW5nZSB9IGZyb20gJy4uL3dvcmtlcnMvY29tbW9uJztcblxuY29uc3QgREVTVFJVQ1RJVkVfQ0hBTkdFUyA9ICchIURFU1RSVUNUSVZFX0NIQU5HRVM6JztcblxuLyoqXG4gKiBPcHRpb25zIGZvciBjcmVhdGluZyBhbiBpbnRlZ3JhdGlvbiB0ZXN0IHJ1bm5lclxuICovXG5leHBvcnQgaW50ZXJmYWNlIEludGVnUnVubmVyT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBJbmZvcm1hdGlvbiBhYm91dCB0aGUgdGVzdCB0byBydW5cbiAgICovXG4gIHJlYWRvbmx5IHRlc3Q6IEludGVnVGVzdDtcblxuICAvKipcbiAgICogVGhlIEFXUyBwcm9maWxlIHRvIHVzZSB3aGVuIGludm9raW5nIHRoZSBDREsgQ0xJXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gbm8gcHJvZmlsZSBpcyBwYXNzZWQsIHRoZSBkZWZhdWx0IHByb2ZpbGUgaXMgdXNlZFxuICAgKi9cbiAgcmVhZG9ubHkgcHJvZmlsZT86IHN0cmluZztcblxuICAvKipcbiAgICogQWRkaXRpb25hbCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdGhhdCB3aWxsIGJlIGF2YWlsYWJsZVxuICAgKiB0byB0aGUgQ0RLIENMSVxuICAgKlxuICAgKiBAZGVmYXVsdCAtIG5vIGFkZGl0aW9uYWwgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAqL1xuICByZWFkb25seSBlbnY/OiB7IFtuYW1lOiBzdHJpbmddOiBzdHJpbmcgfTtcblxuICAvKipcbiAgICogdG1wIGNkay5vdXQgZGlyZWN0b3J5XG4gICAqXG4gICAqIEBkZWZhdWx0IC0gZGlyZWN0b3J5IHdpbGwgYmUgYGNkay1pbnRlZy5vdXQuJHt0ZXN0TmFtZX1gXG4gICAqL1xuICByZWFkb25seSBpbnRlZ091dERpcj86IHN0cmluZztcblxuICAvKipcbiAgICogSW5zdGFuY2Ugb2YgdGhlIENESyBDTEkgdG8gdXNlXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gQ2RrQ2xpV3JhcHBlclxuICAgKi9cbiAgcmVhZG9ubHkgY2RrPzogSUNkaztcblxuICAvKipcbiAgICogU2hvdyBvdXRwdXQgZnJvbSBydW5uaW5nIGludGVncmF0aW9uIHRlc3RzXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBzaG93T3V0cHV0PzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBUaGUgZGlmZmVyZW50IGNvbXBvbmVudHMgb2YgYSB0ZXN0IG5hbWVcbiAqL1xuLyoqXG4gKiBSZXByZXNlbnRzIGFuIEludGVncmF0aW9uIHRlc3QgcnVubmVyXG4gKi9cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBJbnRlZ1J1bm5lciB7XG4gIC8qKlxuICAgKiBUaGUgZGlyZWN0b3J5IHdoZXJlIHRoZSBzbmFwc2hvdCB3aWxsIGJlIHN0b3JlZFxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IHNuYXBzaG90RGlyOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIEFuIGluc3RhbmNlIG9mIHRoZSBDREsgIENMSVxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IGNkazogSUNkaztcblxuICAvKipcbiAgICogUHJldHR5IG5hbWUgb2YgdGhlIHRlc3RcbiAgICovXG4gIHB1YmxpYyByZWFkb25seSB0ZXN0TmFtZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgdmFsdWUgdXNlZCBpbiB0aGUgJy0tYXBwJyBDTEkgcGFyYW1ldGVyXG4gICAqXG4gICAqIFBhdGggdG8gdGhlIGludGVnIHRlc3Qgc291cmNlIGZpbGUsIHJlbGF0aXZlIHRvIGB0aGlzLmRpcmVjdG9yeWAuXG4gICAqL1xuICBwcm90ZWN0ZWQgcmVhZG9ubHkgY2RrQXBwOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSBwYXRoIHdoZXJlIHRoZSBgY2RrLmNvbnRleHQuanNvbmAgZmlsZVxuICAgKiB3aWxsIGJlIGNyZWF0ZWRcbiAgICovXG4gIHByb3RlY3RlZCByZWFkb25seSBjZGtDb250ZXh0UGF0aDogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgdGVzdCBzdWl0ZSBmcm9tIHRoZSBleGlzdGluZyBzbmFwc2hvdFxuICAgKi9cbiAgcHJvdGVjdGVkIHJlYWRvbmx5IGV4cGVjdGVkVGVzdFN1aXRlPzogSW50ZWdUZXN0U3VpdGUgfCBMZWdhY3lJbnRlZ1Rlc3RTdWl0ZTtcblxuICAvKipcbiAgICogVGhlIHRlc3Qgc3VpdGUgZnJvbSB0aGUgbmV3IFwiYWN0dWFsXCIgc25hcHNob3RcbiAgICovXG4gIHByb3RlY3RlZCByZWFkb25seSBhY3R1YWxUZXN0U3VpdGU6IEludGVnVGVzdFN1aXRlIHwgTGVnYWN5SW50ZWdUZXN0U3VpdGU7XG5cbiAgLyoqXG4gICAqIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGF0IHRoZSBpbnRlZ3JhdGlvbiB0ZXN0cyB3aWxsIGJlXG4gICAqIGV4ZWN1dGVkIGZyb21cbiAgICovXG4gIHByb3RlY3RlZCByZWFkb25seSBkaXJlY3Rvcnk6IHN0cmluZztcblxuICAvKipcbiAgICogVGhlIHRlc3QgdG8gcnVuXG4gICAqL1xuICBwcm90ZWN0ZWQgcmVhZG9ubHkgdGVzdDogSW50ZWdUZXN0O1xuXG4gIC8qKlxuICAgKiBEZWZhdWx0IG9wdGlvbnMgdG8gcGFzcyB0byB0aGUgQ0RLIENMSVxuICAgKi9cbiAgcHJvdGVjdGVkIHJlYWRvbmx5IGRlZmF1bHRBcmdzOiBEZWZhdWx0Q2RrT3B0aW9ucyA9IHtcbiAgICBwYXRoTWV0YWRhdGE6IGZhbHNlLFxuICAgIGFzc2V0TWV0YWRhdGE6IGZhbHNlLFxuICAgIHZlcnNpb25SZXBvcnRpbmc6IGZhbHNlLFxuICB9O1xuXG4gIC8qKlxuICAgKiBUaGUgZGlyZWN0b3J5IHdoZXJlIHRoZSBDREsgd2lsbCBiZSBzeW50aGVkIHRvXG4gICAqXG4gICAqIFJlbGF0aXZlIHRvIGN3ZC5cbiAgICovXG4gIHByb3RlY3RlZCByZWFkb25seSBjZGtPdXREaXI6IHN0cmluZztcblxuICBwcm90ZWN0ZWQgcmVhZG9ubHkgcHJvZmlsZT86IHN0cmluZztcblxuICBwcm90ZWN0ZWQgX2Rlc3RydWN0aXZlQ2hhbmdlcz86IERlc3RydWN0aXZlQ2hhbmdlW107XG4gIHByaXZhdGUgbGVnYWN5Q29udGV4dD86IFJlY29yZDxzdHJpbmcsIGFueT47XG4gIHByb3RlY3RlZCBpc0xlZ2FjeVRlc3Q/OiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IEludGVnUnVubmVyT3B0aW9ucykge1xuICAgIHRoaXMudGVzdCA9IG9wdGlvbnMudGVzdDtcbiAgICB0aGlzLmRpcmVjdG9yeSA9IHRoaXMudGVzdC5kaXJlY3Rvcnk7XG4gICAgdGhpcy50ZXN0TmFtZSA9IHRoaXMudGVzdC50ZXN0TmFtZTtcbiAgICB0aGlzLnNuYXBzaG90RGlyID0gdGhpcy50ZXN0LnNuYXBzaG90RGlyO1xuICAgIHRoaXMuY2RrQ29udGV4dFBhdGggPSBwYXRoLmpvaW4odGhpcy5kaXJlY3RvcnksICdjZGsuY29udGV4dC5qc29uJyk7XG5cbiAgICB0aGlzLmNkayA9IG9wdGlvbnMuY2RrID8/IG5ldyBDZGtDbGlXcmFwcGVyKHtcbiAgICAgIGRpcmVjdG9yeTogdGhpcy5kaXJlY3RvcnksXG4gICAgICBzaG93T3V0cHV0OiBvcHRpb25zLnNob3dPdXRwdXQsXG4gICAgICBlbnY6IHtcbiAgICAgICAgLi4ub3B0aW9ucy5lbnYsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRoaXMuY2RrT3V0RGlyID0gb3B0aW9ucy5pbnRlZ091dERpciA/PyB0aGlzLnRlc3QudGVtcG9yYXJ5T3V0cHV0RGlyO1xuXG4gICAgY29uc3QgdGVzdFJ1bkNvbW1hbmQgPSB0aGlzLnRlc3QuYXBwQ29tbWFuZDtcbiAgICB0aGlzLmNka0FwcCA9IHRlc3RSdW5Db21tYW5kLnJlcGxhY2UoJ3tmaWxlUGF0aH0nLCBwYXRoLnJlbGF0aXZlKHRoaXMuZGlyZWN0b3J5LCB0aGlzLnRlc3QuZmlsZU5hbWUpKTtcblxuICAgIHRoaXMucHJvZmlsZSA9IG9wdGlvbnMucHJvZmlsZTtcbiAgICBpZiAodGhpcy5oYXNTbmFwc2hvdCgpKSB7XG4gICAgICB0aGlzLmV4cGVjdGVkVGVzdFN1aXRlID0gdGhpcy5sb2FkTWFuaWZlc3QoKTtcbiAgICB9XG4gICAgdGhpcy5hY3R1YWxUZXN0U3VpdGUgPSB0aGlzLmdlbmVyYXRlQWN0dWFsU25hcHNob3QoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gdGhlIGxpc3Qgb2YgZXhwZWN0ZWQgKGkuZS4gZXhpc3RpbmcpIHRlc3QgY2FzZXMgZm9yIHRoaXMgaW50ZWdyYXRpb24gdGVzdFxuICAgKi9cbiAgcHVibGljIGV4cGVjdGVkVGVzdHMoKTogeyBbdGVzdE5hbWU6IHN0cmluZ106IFRlc3RDYXNlIH0gfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmV4cGVjdGVkVGVzdFN1aXRlPy50ZXN0U3VpdGU7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIHRoZSBsaXN0IG9mIGFjdHVhbCAoaS5lLiBuZXcpIHRlc3QgY2FzZXMgZm9yIHRoaXMgaW50ZWdyYXRpb24gdGVzdFxuICAgKi9cbiAgcHVibGljIGFjdHVhbFRlc3RzKCk6IHsgW3Rlc3ROYW1lOiBzdHJpbmddOiBUZXN0Q2FzZSB9IHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5hY3R1YWxUZXN0U3VpdGUudGVzdFN1aXRlO1xuICB9XG5cbiAgLyoqXG4gICAqIEdlbmVyYXRlIGEgbmV3IFwiYWN0dWFsXCIgc25hcHNob3Qgd2hpY2ggd2lsbCBiZSBjb21wYXJlZCB0byB0aGVcbiAgICogZXhpc3RpbmcgXCJleHBlY3RlZFwiIHNuYXBzaG90XG4gICAqIFRoaXMgd2lsbCBzeW50aCBhbmQgdGhlbiBsb2FkIHRoZSBpbnRlZ3JhdGlvbiB0ZXN0IG1hbmlmZXN0XG4gICAqL1xuICBwdWJsaWMgZ2VuZXJhdGVBY3R1YWxTbmFwc2hvdCgpOiBJbnRlZ1Rlc3RTdWl0ZSB8IExlZ2FjeUludGVnVGVzdFN1aXRlIHtcbiAgICB0aGlzLmNkay5zeW50aEZhc3Qoe1xuICAgICAgZXhlY0NtZDogdGhpcy5jZGtBcHAuc3BsaXQoJyAnKSxcbiAgICAgIGVudjoge1xuICAgICAgICAuLi5ERUZBVUxUX1NZTlRIX09QVElPTlMuZW52LFxuICAgICAgICAvLyB3ZSBkb24ndCBrbm93IHRoZSBcImFjdHVhbFwiIGNvbnRleHQgeWV0ICh0aGlzIG1ldGhvZCBpcyB3aGF0IGdlbmVyYXRlcyBpdCkgc28ganVzdFxuICAgICAgICAvLyB1c2UgdGhlIFwiZXhwZWN0ZWRcIiBjb250ZXh0LiBUaGlzIGlzIG9ubHkgcnVuIGluIG9yZGVyIHRvIHJlYWQgdGhlIG1hbmlmZXN0XG4gICAgICAgIENES19DT05URVhUX0pTT046IEpTT04uc3RyaW5naWZ5KHRoaXMuZ2V0Q29udGV4dCh0aGlzLmV4cGVjdGVkVGVzdFN1aXRlPy5zeW50aENvbnRleHQpKSxcbiAgICAgIH0sXG4gICAgICBvdXRwdXQ6IHBhdGgucmVsYXRpdmUodGhpcy5kaXJlY3RvcnksIHRoaXMuY2RrT3V0RGlyKSxcbiAgICB9KTtcbiAgICBjb25zdCBtYW5pZmVzdCA9IHRoaXMubG9hZE1hbmlmZXN0KHRoaXMuY2RrT3V0RGlyKTtcbiAgICAvLyBhZnRlciB3ZSBsb2FkIHRoZSBtYW5pZmVzdCByZW1vdmUgdGhlIHRtcCBzbmFwc2hvdFxuICAgIC8vIHNvIHRoYXQgaXQgZG9lc24ndCBtZXNzIHVwIHRoZSByZWFsIHNuYXBzaG90IGNyZWF0ZWQgbGF0ZXJcbiAgICB0aGlzLmNsZWFudXAoKTtcbiAgICByZXR1cm4gbWFuaWZlc3Q7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0cnVlIGlmIGEgc25hcHNob3QgYWxyZWFkeSBleGlzdHMgZm9yIHRoaXMgdGVzdFxuICAgKi9cbiAgcHVibGljIGhhc1NuYXBzaG90KCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBmcy5leGlzdHNTeW5jKHRoaXMuc25hcHNob3REaXIpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvYWQgdGhlIGludGVnIG1hbmlmZXN0IHdoaWNoIGNvbnRhaW5zIGluZm9ybWF0aW9uXG4gICAqIG9uIGhvdyB0byBleGVjdXRlIHRoZSB0ZXN0c1xuICAgKiBGaXJzdCB3ZSB0cnkgYW5kIGxvYWQgdGhlIG1hbmlmZXN0IGZyb20gdGhlIGludGVnIG1hbmlmZXN0IChpLmUuIGludGVnLmpzb24pXG4gICAqIGZyb20gdGhlIGNsb3VkIGFzc2VtYmx5LiBJZiBpdCBkb2Vzbid0IGV4aXN0LCB0aGVuIHdlIGZhbGxiYWNrIHRvIHRoZVxuICAgKiBcImxlZ2FjeSBtb2RlXCIgYW5kIGNyZWF0ZSBhIG1hbmlmZXN0IGZyb20gcHJhZ21hXG4gICAqL1xuICBwcm90ZWN0ZWQgbG9hZE1hbmlmZXN0KGRpcj86IHN0cmluZyk6IEludGVnVGVzdFN1aXRlIHwgTGVnYWN5SW50ZWdUZXN0U3VpdGUge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB0ZXN0U3VpdGUgPSBJbnRlZ1Rlc3RTdWl0ZS5mcm9tUGF0aChkaXIgPz8gdGhpcy5zbmFwc2hvdERpcik7XG4gICAgICByZXR1cm4gdGVzdFN1aXRlO1xuICAgIH0gY2F0Y2gge1xuICAgICAgY29uc3QgdGVzdENhc2VzID0gTGVnYWN5SW50ZWdUZXN0U3VpdGUuZnJvbUxlZ2FjeSh7XG4gICAgICAgIGNkazogdGhpcy5jZGssXG4gICAgICAgIHRlc3ROYW1lOiB0aGlzLnRlc3Qubm9ybWFsaXplZFRlc3ROYW1lLFxuICAgICAgICBpbnRlZ1NvdXJjZUZpbGVQYXRoOiB0aGlzLnRlc3QuZmlsZU5hbWUsXG4gICAgICAgIGxpc3RPcHRpb25zOiB7XG4gICAgICAgICAgLi4udGhpcy5kZWZhdWx0QXJncyxcbiAgICAgICAgICBhbGw6IHRydWUsXG4gICAgICAgICAgYXBwOiB0aGlzLmNka0FwcCxcbiAgICAgICAgICBwcm9maWxlOiB0aGlzLnByb2ZpbGUsXG4gICAgICAgICAgb3V0cHV0OiBwYXRoLnJlbGF0aXZlKHRoaXMuZGlyZWN0b3J5LCB0aGlzLmNka091dERpciksXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIHRoaXMubGVnYWN5Q29udGV4dCA9IExlZ2FjeUludGVnVGVzdFN1aXRlLmdldFByYWdtYUNvbnRleHQodGhpcy50ZXN0LmZpbGVOYW1lKTtcbiAgICAgIHRoaXMuaXNMZWdhY3lUZXN0ID0gdHJ1ZTtcbiAgICAgIHJldHVybiB0ZXN0Q2FzZXM7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGNsZWFudXAoKTogdm9pZCB7XG4gICAgY29uc3QgY2RrT3V0UGF0aCA9IHRoaXMuY2RrT3V0RGlyO1xuICAgIGlmIChmcy5leGlzdHNTeW5jKGNka091dFBhdGgpKSB7XG4gICAgICBmcy5yZW1vdmVTeW5jKGNka091dFBhdGgpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJZiB0aGVyZSBhcmUgYW55IGRlc3RydWN0aXZlIGNoYW5nZXMgdG8gYSBzdGFjayB0aGVuIHRoaXMgd2lsbCByZWNvcmRcbiAgICogdGhvc2UgaW4gdGhlIG1hbmlmZXN0Lmpzb24gZmlsZVxuICAgKi9cbiAgcHJpdmF0ZSByZW5kZXJUcmFjZURhdGEoKTogTWFuaWZlc3RUcmFjZSB7XG4gICAgY29uc3QgdHJhY2VEYXRhOiBNYW5pZmVzdFRyYWNlID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IGRlc3RydWN0aXZlQ2hhbmdlcyA9IHRoaXMuX2Rlc3RydWN0aXZlQ2hhbmdlcyA/PyBbXTtcbiAgICBkZXN0cnVjdGl2ZUNoYW5nZXMuZm9yRWFjaChjaGFuZ2UgPT4ge1xuICAgICAgY29uc3QgdHJhY2UgPSB0cmFjZURhdGEuZ2V0KGNoYW5nZS5zdGFja05hbWUpO1xuICAgICAgaWYgKHRyYWNlKSB7XG4gICAgICAgIHRyYWNlLnNldChjaGFuZ2UubG9naWNhbElkLCBgJHtERVNUUlVDVElWRV9DSEFOR0VTfSAke2NoYW5nZS5pbXBhY3R9YCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0cmFjZURhdGEuc2V0KGNoYW5nZS5zdGFja05hbWUsIG5ldyBNYXAoW1xuICAgICAgICAgIFtjaGFuZ2UubG9naWNhbElkLCBgJHtERVNUUlVDVElWRV9DSEFOR0VTfSAke2NoYW5nZS5pbXBhY3R9YF0sXG4gICAgICAgIF0pKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gdHJhY2VEYXRhO1xuICB9XG5cbiAgLyoqXG4gICAqIEluIGNhc2VzIHdoZXJlIHdlIGRvIG5vdCB3YW50IHRvIHJldGFpbiB0aGUgYXNzZXRzLFxuICAgKiBmb3IgZXhhbXBsZSwgaWYgdGhlIGFzc2V0cyBhcmUgdmVyeSBsYXJnZS5cbiAgICpcbiAgICogU2luY2UgaXQgaXMgcG9zc2libGUgdG8gZGlzYWJsZSB0aGUgdXBkYXRlIHdvcmtmbG93IGZvciBpbmRpdmlkdWFsIHRlc3RcbiAgICogY2FzZXMsIHRoaXMgbmVlZHMgdG8gZmlyc3QgZ2V0IGEgbGlzdCBvZiBzdGFja3MgdGhhdCBoYXZlIHRoZSB1cGRhdGUgd29ya2Zsb3dcbiAgICogZGlzYWJsZWQgYW5kIHRoZW4gZGVsZXRlIGFzc2V0cyB0aGF0IHJlbGF0ZSB0byB0aGF0IHN0YWNrLiBJdCBkb2VzIHRoYXRcbiAgICogYnkgcmVhZGluZyB0aGUgYXNzZXQgbWFuaWZlc3QgZm9yIHRoZSBzdGFjayBhbmQgZGVsZXRpbmcgdGhlIGFzc2V0IHNvdXJjZVxuICAgKi9cbiAgcHJvdGVjdGVkIHJlbW92ZUFzc2V0c0Zyb21TbmFwc2hvdCgpOiB2b2lkIHtcbiAgICBjb25zdCBzdGFja3MgPSB0aGlzLmFjdHVhbFRlc3RTdWl0ZS5nZXRTdGFja3NXaXRob3V0VXBkYXRlV29ya2Zsb3coKSA/PyBbXTtcbiAgICBjb25zdCBtYW5pZmVzdCA9IEFzc2VtYmx5TWFuaWZlc3RSZWFkZXIuZnJvbVBhdGgodGhpcy5zbmFwc2hvdERpcik7XG4gICAgY29uc3QgYXNzZXRzID0gZmxhdHRlbihzdGFja3MubWFwKHN0YWNrID0+IHtcbiAgICAgIHJldHVybiBtYW5pZmVzdC5nZXRBc3NldExvY2F0aW9uc0ZvclN0YWNrKHN0YWNrKSA/PyBbXTtcbiAgICB9KSk7XG5cbiAgICBhc3NldHMuZm9yRWFjaChhc3NldCA9PiB7XG4gICAgICBjb25zdCBmaWxlTmFtZSA9IHBhdGguam9pbih0aGlzLnNuYXBzaG90RGlyLCBhc3NldCk7XG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlTmFtZSkpIHtcbiAgICAgICAgaWYgKGZzLmxzdGF0U3luYyhmaWxlTmFtZSkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgIGZzLnJlbW92ZVN5bmMoZmlsZU5hbWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZzLnVubGlua1N5bmMoZmlsZU5hbWUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIHRoZSBhc3NldCBjYWNoZSAoLmNhY2hlLykgZmlsZXMgZnJvbSB0aGUgc25hcHNob3QuXG4gICAqIFRoZXNlIGFyZSBhIGNhY2hlIG9mIHRoZSBhc3NldCB6aXBzLCBidXQgd2UgYXJlIGZpbmUgd2l0aFxuICAgKiByZS16aXBwaW5nIG9uIGRlcGxveVxuICAgKi9cbiAgcHJvdGVjdGVkIHJlbW92ZUFzc2V0c0NhY2hlRnJvbVNuYXBzaG90KCk6IHZvaWQge1xuICAgIGNvbnN0IGZpbGVzID0gZnMucmVhZGRpclN5bmModGhpcy5zbmFwc2hvdERpcik7XG4gICAgZmlsZXMuZm9yRWFjaChmaWxlID0+IHtcbiAgICAgIGNvbnN0IGZpbGVOYW1lID0gcGF0aC5qb2luKHRoaXMuc25hcHNob3REaXIsIGZpbGUpO1xuICAgICAgaWYgKGZzLmxzdGF0U3luYyhmaWxlTmFtZSkuaXNEaXJlY3RvcnkoKSAmJiBmaWxlID09PSAnLmNhY2hlJykge1xuICAgICAgICBmcy5lbXB0eURpclN5bmMoZmlsZU5hbWUpO1xuICAgICAgICBmcy5ybWRpclN5bmMoZmlsZU5hbWUpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSB0aGUgbmV3IHNuYXBzaG90LlxuICAgKlxuICAgKiBJZiBsb29rdXBzIGFyZSBlbmFibGVkLCB0aGVuIHdlIG5lZWQgY3JlYXRlIHRoZSBzbmFwc2hvdCBieSBzeW50aGluZyBhZ2FpblxuICAgKiB3aXRoIHRoZSBkdW1teSBjb250ZXh0IHNvIHRoYXQgZWFjaCB0aW1lIHRoZSB0ZXN0IGlzIHJ1biBvbiBkaWZmZXJlbnQgbWFjaGluZXNcbiAgICogKGFuZCB3aXRoIGRpZmZlcmVudCBjb250ZXh0L2VudikgdGhlIGRpZmYgd2lsbCBub3QgY2hhbmdlLlxuICAgKlxuICAgKiBJZiBsb29rdXBzIGFyZSBkaXNhYmxlZCAod2hpY2ggbWVhbnMgdGhlIHN0YWNrIGlzIGVudiBhZ25vc3RpYykgdGhlbiBqdXN0IGNvcHlcbiAgICogdGhlIGFzc2VtYmx5IHRoYXQgd2FzIG91dHB1dCBieSB0aGUgZGVwbG95bWVudFxuICAgKi9cbiAgcHJvdGVjdGVkIGNyZWF0ZVNuYXBzaG90KCk6IHZvaWQge1xuICAgIGlmIChmcy5leGlzdHNTeW5jKHRoaXMuc25hcHNob3REaXIpKSB7XG4gICAgICBmcy5yZW1vdmVTeW5jKHRoaXMuc25hcHNob3REaXIpO1xuICAgIH1cblxuICAgIC8vIGlmIGxvb2t1cHMgYXJlIGVuYWJsZWQgdGhlbiB3ZSBuZWVkIHRvIHN5bnRoIGFnYWluXG4gICAgLy8gdXNpbmcgZHVtbXkgY29udGV4dCBhbmQgc2F2ZSB0aGF0IGFzIHRoZSBzbmFwc2hvdFxuICAgIGlmICh0aGlzLmFjdHVhbFRlc3RTdWl0ZS5lbmFibGVMb29rdXBzKSB7XG4gICAgICB0aGlzLmNkay5zeW50aEZhc3Qoe1xuICAgICAgICBleGVjQ21kOiB0aGlzLmNka0FwcC5zcGxpdCgnICcpLFxuICAgICAgICBlbnY6IHtcbiAgICAgICAgICAuLi5ERUZBVUxUX1NZTlRIX09QVElPTlMuZW52LFxuICAgICAgICAgIENES19DT05URVhUX0pTT046IEpTT04uc3RyaW5naWZ5KHRoaXMuZ2V0Q29udGV4dChERUZBVUxUX1NZTlRIX09QVElPTlMuY29udGV4dCkpLFxuICAgICAgICB9LFxuICAgICAgICBvdXRwdXQ6IHBhdGgucmVsYXRpdmUodGhpcy5kaXJlY3RvcnksIHRoaXMuc25hcHNob3REaXIpLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZzLm1vdmVTeW5jKHRoaXMuY2RrT3V0RGlyLCB0aGlzLnNuYXBzaG90RGlyLCB7IG92ZXJ3cml0ZTogdHJ1ZSB9KTtcbiAgICB9XG5cbiAgICB0aGlzLmNsZWFudXBTbmFwc2hvdCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFBlcmZvcm0gc29tZSBjbGVhbnVwIHN0ZXBzIGFmdGVyIHRoZSBzbmFwc2hvdCBpcyBjcmVhdGVkXG4gICAqIEFueXRpbWUgdGhlIHNuYXBzaG90IG5lZWRzIHRvIGJlIG1vZGlmaWVkIGFmdGVyIGNyZWF0aW9uXG4gICAqIHRoZSBsb2dpYyBzaG91bGQgbGl2ZSBoZXJlLlxuICAgKi9cbiAgcHJpdmF0ZSBjbGVhbnVwU25hcHNob3QoKTogdm9pZCB7XG4gICAgaWYgKGZzLmV4aXN0c1N5bmModGhpcy5zbmFwc2hvdERpcikpIHtcbiAgICAgIHRoaXMucmVtb3ZlQXNzZXRzRnJvbVNuYXBzaG90KCk7XG4gICAgICB0aGlzLnJlbW92ZUFzc2V0c0NhY2hlRnJvbVNuYXBzaG90KCk7XG4gICAgICBjb25zdCBhc3NlbWJseSA9IEFzc2VtYmx5TWFuaWZlc3RSZWFkZXIuZnJvbVBhdGgodGhpcy5zbmFwc2hvdERpcik7XG4gICAgICBhc3NlbWJseS5jbGVhbk1hbmlmZXN0KCk7XG4gICAgICBhc3NlbWJseS5yZWNvcmRUcmFjZSh0aGlzLnJlbmRlclRyYWNlRGF0YSgpKTtcbiAgICB9XG5cbiAgICAvLyBpZiB0aGlzIGlzIGEgbGVnYWN5IHRlc3QgdGhlbiBjcmVhdGUgYW4gaW50ZWcgbWFuaWZlc3RcbiAgICAvLyBpbiB0aGUgc25hcHNob3QgZGlyZWN0b3J5IHdoaWNoIGNhbiBiZSB1c2VkIGZvciB0aGVcbiAgICAvLyB1cGRhdGUgd29ya2Zsb3cuIFNhdmUgYW55IGxlZ2FjeUNvbnRleHQgYXMgd2VsbCBzbyB0aGF0IGl0IGNhbiBiZSByZWFkXG4gICAgLy8gdGhlIG5leHQgdGltZVxuICAgIGlmICh0aGlzLmFjdHVhbFRlc3RTdWl0ZS50eXBlID09PSAnbGVnYWN5LXRlc3Qtc3VpdGUnKSB7XG4gICAgICAodGhpcy5hY3R1YWxUZXN0U3VpdGUgYXMgTGVnYWN5SW50ZWdUZXN0U3VpdGUpLnNhdmVNYW5pZmVzdCh0aGlzLnNuYXBzaG90RGlyLCB0aGlzLmxlZ2FjeUNvbnRleHQpO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRDb250ZXh0KGFkZGl0aW9uYWxDb250ZXh0PzogUmVjb3JkPHN0cmluZywgYW55Pik6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIHJldHVybiB7XG4gICAgICAuLi5jdXJyZW50bHlSZWNvbW1lbmRlZEF3c0Nka0xpYkZsYWdzKCksXG4gICAgICAuLi50aGlzLmxlZ2FjeUNvbnRleHQsXG4gICAgICAuLi5hZGRpdGlvbmFsQ29udGV4dCxcblxuICAgICAgLy8gV2Ugb3JpZ2luYWxseSBoYWQgUExBTk5FRCB0byBzZXQgdGhpcyB0byBbJ2F3cycsICdhd3MtY24nXSwgYnV0IGR1ZSB0byBhIHByb2dyYW1taW5nIG1pc3Rha2VcbiAgICAgIC8vIGl0IHdhcyBzZXQgdG8gZXZlcnl0aGluZy4gSW4gdGhpcyBQUiwgc2V0IGl0IHRvIGV2ZXJ5dGhpbmcgdG8gbm90IG1lc3MgdXAgYWxsIHRoZSBzbmFwc2hvdHMuXG4gICAgICBbVEFSR0VUX1BBUlRJVElPTlNdOiB1bmRlZmluZWQsXG5cbiAgICAgIC8qIC0tLS0tLS0tLS0tLS0tLS0gVEhFIEZVVFVSRSBMSVZFUyBCRUxPVy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAgIC8vIFJlc3RyaWN0aW5nIHRvIHRoZXNlIHRhcmdldCBwYXJ0aXRpb25zIG1ha2VzIG1vc3Qgc2VydmljZSBwcmluY2lwYWxzIHN5bnRoZXNpemUgdG9cbiAgICAgIC8vIGBzZXJ2aWNlLiR7VVJMX1NVRkZJWH1gLCB3aGljaCBpcyB0ZWNobmljYWxseSAqaW5jb3JyZWN0KiAoaXQncyBvbmx5IGBhbWF6b25hd3MuY29tYFxuICAgICAgLy8gb3IgYGFtYXpvbmF3cy5jb20uY25gLCBuZXZlciBVcmxTdWZmaXggZm9yIGFueSBvZiB0aGUgcmVzdHJpY3RlZCByZWdpb25zKSBidXQgaXQncyB3aGF0XG4gICAgICAvLyBtb3N0IGV4aXN0aW5nIGludGVnIHRlc3RzIGNvbnRhaW4sIGFuZCB3ZSB3YW50IHRvIGRpc3R1cmIgYXMgZmV3IGFzIHBvc3NpYmxlLlxuICAgICAgLy8gW1RBUkdFVF9QQVJUSVRJT05TXTogWydhd3MnLCAnYXdzLWNuJ10sXG4gICAgICAvKiAtLS0tLS0tLS0tLS0tLS0tIEVORCBPRiBUSEUgRlVUVVJFIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cbiAgICB9O1xuICB9XG59XG5cbi8vIERlZmF1bHQgY29udGV4dCB3ZSBydW4gYWxsIGludGVnIHRlc3RzIHdpdGgsIHNvIHRoZXkgZG9uJ3QgZGVwZW5kIG9uIHRoZVxuLy8gYWNjb3VudCBvZiB0aGUgZXhlcmNpc2luZyB1c2VyLlxuZXhwb3J0IGNvbnN0IERFRkFVTFRfU1lOVEhfT1BUSU9OUyA9IHtcbiAgY29udGV4dDoge1xuICAgIFtBVkFJTEFCSUxJVFlfWk9ORV9GQUxMQkFDS19DT05URVhUX0tFWV06IFsndGVzdC1yZWdpb24tMWEnLCAndGVzdC1yZWdpb24tMWInLCAndGVzdC1yZWdpb24tMWMnXSxcbiAgICAnYXZhaWxhYmlsaXR5LXpvbmVzOmFjY291bnQ9MTIzNDU2Nzg6cmVnaW9uPXRlc3QtcmVnaW9uJzogWyd0ZXN0LXJlZ2lvbi0xYScsICd0ZXN0LXJlZ2lvbi0xYicsICd0ZXN0LXJlZ2lvbi0xYyddLFxuICAgICdzc206YWNjb3VudD0xMjM0NTY3ODpwYXJhbWV0ZXJOYW1lPS9hd3Mvc2VydmljZS9hbWktYW1hem9uLWxpbnV4LWxhdGVzdC9hbXpuLWFtaS1odm0teDg2XzY0LWdwMjpyZWdpb249dGVzdC1yZWdpb24nOiAnYW1pLTEyMzQnLFxuICAgICdzc206YWNjb3VudD0xMjM0NTY3ODpwYXJhbWV0ZXJOYW1lPS9hd3Mvc2VydmljZS9hbWktYW1hem9uLWxpbnV4LWxhdGVzdC9hbXpuMi1hbWktaHZtLXg4Nl82NC1ncDI6cmVnaW9uPXRlc3QtcmVnaW9uJzogJ2FtaS0xMjM0JyxcbiAgICAnc3NtOmFjY291bnQ9MTIzNDU2Nzg6cGFyYW1ldGVyTmFtZT0vYXdzL3NlcnZpY2UvZWNzL29wdGltaXplZC1hbWkvYW1hem9uLWxpbnV4L3JlY29tbWVuZGVkOnJlZ2lvbj10ZXN0LXJlZ2lvbic6ICd7XCJpbWFnZV9pZFwiOiBcImFtaS0xMjM0XCJ9JyxcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHN0eWxpc3RpYy9tYXgtbGVuXG4gICAgJ2FtaTphY2NvdW50PTEyMzQ1Njc4OmZpbHRlcnMuaW1hZ2UtdHlwZS4wPW1hY2hpbmU6ZmlsdGVycy5uYW1lLjA9YW16bi1hbWktdnBjLW5hdC0qOmZpbHRlcnMuc3RhdGUuMD1hdmFpbGFibGU6b3duZXJzLjA9YW1hem9uOnJlZ2lvbj10ZXN0LXJlZ2lvbic6ICdhbWktMTIzNCcsXG4gICAgJ3ZwYy1wcm92aWRlcjphY2NvdW50PTEyMzQ1Njc4OmZpbHRlci5pc0RlZmF1bHQ9dHJ1ZTpyZWdpb249dGVzdC1yZWdpb246cmV0dXJuQXN5bW1ldHJpY1N1Ym5ldHM9dHJ1ZSc6IHtcbiAgICAgIHZwY0lkOiAndnBjLTYwOTAwOTA1JyxcbiAgICAgIHN1Ym5ldEdyb3VwczogW1xuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ1B1YmxpYycsXG4gICAgICAgICAgbmFtZTogJ1B1YmxpYycsXG4gICAgICAgICAgc3VibmV0czogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdWJuZXRJZDogJ3N1Ym5ldC1lMTk0NTVjYScsXG4gICAgICAgICAgICAgIGF2YWlsYWJpbGl0eVpvbmU6ICd1cy1lYXN0LTFhJyxcbiAgICAgICAgICAgICAgcm91dGVUYWJsZUlkOiAncnRiLWUxOTQ1NWNhJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN1Ym5ldElkOiAnc3VibmV0LWUwYzI0Nzk3JyxcbiAgICAgICAgICAgICAgYXZhaWxhYmlsaXR5Wm9uZTogJ3VzLWVhc3QtMWInLFxuICAgICAgICAgICAgICByb3V0ZVRhYmxlSWQ6ICdydGItZTBjMjQ3OTcnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3VibmV0SWQ6ICdzdWJuZXQtY2NkNzczOTUnLFxuICAgICAgICAgICAgICBhdmFpbGFiaWxpdHlab25lOiAndXMtZWFzdC0xYycsXG4gICAgICAgICAgICAgIHJvdXRlVGFibGVJZDogJ3J0Yi1jY2Q3NzM5NScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0sXG4gIH0sXG4gIGVudjoge1xuICAgIENES19JTlRFR19BQ0NPVU5UOiAnMTIzNDU2NzgnLFxuICAgIENES19JTlRFR19SRUdJT046ICd0ZXN0LXJlZ2lvbicsXG4gICAgQ0RLX0lOVEVHX0hPU1RFRF9aT05FX0lEOiAnWjIzQUJDNFhZWkwwNUInLFxuICAgIENES19JTlRFR19IT1NURURfWk9ORV9OQU1FOiAnZXhhbXBsZS5jb20nLFxuICAgIENES19JTlRFR19ET01BSU5fTkFNRTogJyouZXhhbXBsZS5jb20nLFxuICAgIENES19JTlRFR19DRVJUX0FSTjogJ2Fybjphd3M6YWNtOnRlc3QtcmVnaW9uOjEyMzQ1Njc4OmNlcnRpZmljYXRlLzg2NDY4MjA5LWEyNzItNTk1ZC1iODMxLTBlZmI2NDIxMjY1eicsXG4gICAgQ0RLX0lOVEVHX1NVQk5FVF9JRDogJ3N1Ym5ldC0wZGZmMWEzOTlkOGY2ZjkyYycsXG4gIH0sXG59O1xuXG4vKipcbiAqIFJldHVybiB0aGUgY3VycmVudGx5IHJlY29tbWVuZGVkIGZsYWdzIGZvciBgYXdzLWNkay1saWJgLlxuICpcbiAqIFRoZXNlIGhhdmUgYmVlbiBidWlsdCBpbnRvIHRoZSBDTEkgYXQgYnVpbGQgdGltZS4gSWYgdGhpcyBldmVyIGdldHMgY2hhbmdlZFxuICogYmFjayB0byBhIGR5bmFtaWMgbG9hZCwgcmVtZW1iZXIgdGhhdCB0aGlzIHNvdXJjZSBmaWxlIG1heSBiZSBidW5kbGVkIGludG9cbiAqIGEgSmF2YVNjcmlwdCBidW5kbGUsIGFuZCBgX19kaXJuYW1lYCBtaWdodCBub3QgcG9pbnQgd2hlcmUgeW91IHRoaW5rIGl0IGRvZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjdXJyZW50bHlSZWNvbW1lbmRlZEF3c0Nka0xpYkZsYWdzKCkge1xuICByZXR1cm4gcmVjb21tZW5kZWRGbGFnc0ZpbGU7XG59XG4iXX0=