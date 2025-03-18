"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegSnapshotRunner = void 0;
const path = require("path");
const stream_1 = require("stream");
const string_decoder_1 = require("string_decoder");
const cloudformation_diff_1 = require("@aws-cdk/cloudformation-diff");
const cloud_assembly_1 = require("./private/cloud-assembly");
const runner_base_1 = require("./runner-base");
const common_1 = require("../workers/common");
/**
 * Runner for snapshot tests. This handles orchestrating
 * the validation of the integration test snapshots
 */
class IntegSnapshotRunner extends runner_base_1.IntegRunner {
    constructor(options) {
        super(options);
    }
    /**
     * Synth the integration tests and compare the templates
     * to the existing snapshot.
     *
     * @returns any diagnostics and any destructive changes
     */
    testSnapshot(options = {}) {
        let doClean = true;
        try {
            const expectedSnapshotAssembly = this.getSnapshotAssembly(this.snapshotDir, this.expectedTestSuite?.stacks);
            // synth the integration test
            // FIXME: ideally we should not need to run this again if
            // the cdkOutDir exists already, but for some reason generateActualSnapshot
            // generates an incorrect snapshot and I have no idea why so synth again here
            // to produce the "correct" snapshot
            const env = {
                ...runner_base_1.DEFAULT_SYNTH_OPTIONS.env,
                CDK_CONTEXT_JSON: JSON.stringify(this.getContext({
                    ...this.actualTestSuite.enableLookups ? runner_base_1.DEFAULT_SYNTH_OPTIONS.context : {},
                })),
            };
            this.cdk.synthFast({
                execCmd: this.cdkApp.split(' '),
                env,
                output: path.relative(this.directory, this.cdkOutDir),
            });
            // read the "actual" snapshot
            const actualSnapshotAssembly = this.getSnapshotAssembly(this.cdkOutDir, this.actualTestSuite.stacks);
            // diff the existing snapshot (expected) with the integration test (actual)
            const diagnostics = this.diffAssembly(expectedSnapshotAssembly, actualSnapshotAssembly);
            if (diagnostics.diagnostics.length) {
                // Attach additional messages to the first diagnostic
                const additionalMessages = [];
                if (options.retain) {
                    additionalMessages.push(`(Failure retained) Expected: ${path.relative(process.cwd(), this.snapshotDir)}`, `                   Actual:   ${path.relative(process.cwd(), this.cdkOutDir)}`),
                        doClean = false;
                }
                if (options.verbose) {
                    // Show the command necessary to repro this
                    const envSet = Object.entries(env)
                        .filter(([k, _]) => k !== 'CDK_CONTEXT_JSON')
                        .map(([k, v]) => `${k}='${v}'`);
                    const envCmd = envSet.length > 0 ? ['env', ...envSet] : [];
                    additionalMessages.push('Repro:', `  ${[...envCmd, 'cdk synth', `-a '${this.cdkApp}'`, `-o '${this.cdkOutDir}'`, ...Object.entries(this.getContext()).flatMap(([k, v]) => typeof v !== 'object' ? [`-c '${k}=${v}'`] : [])].join(' ')}`);
                }
                diagnostics.diagnostics[0] = {
                    ...diagnostics.diagnostics[0],
                    additionalMessages,
                };
            }
            return diagnostics;
        }
        catch (e) {
            throw e;
        }
        finally {
            if (doClean) {
                this.cleanup();
            }
        }
    }
    /**
     * For a given cloud assembly return a collection of all templates
     * that should be part of the snapshot and any required meta data.
     *
     * @param cloudAssemblyDir The directory of the cloud assembly to look for snapshots
     * @param pickStacks Pick only these stacks from the cloud assembly
     * @returns A SnapshotAssembly, the collection of all templates in this snapshot and required meta data
     */
    getSnapshotAssembly(cloudAssemblyDir, pickStacks = []) {
        const assembly = this.readAssembly(cloudAssemblyDir);
        const stacks = assembly.stacks;
        const snapshots = {};
        for (const [stackName, stackTemplate] of Object.entries(stacks)) {
            if (pickStacks.includes(stackName)) {
                const manifest = cloud_assembly_1.AssemblyManifestReader.fromPath(cloudAssemblyDir);
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
    /**
     * For a given stack return all resource types that are allowed to be destroyed
     * as part of a stack update
     *
     * @param stackId the stack id
     * @returns a list of resource types or undefined if none are found
     */
    getAllowedDestroyTypesForStack(stackId) {
        for (const testCase of Object.values(this.actualTests() ?? {})) {
            if (testCase.stacks.includes(stackId)) {
                return testCase.allowDestroy;
            }
        }
        return undefined;
    }
    /**
     * Find any differences between the existing and expected snapshots
     *
     * @param existing - the existing (expected) snapshot
     * @param actual - the new (actual) snapshot
     * @returns any diagnostics and any destructive changes
     */
    diffAssembly(expected, actual) {
        const failures = [];
        const destructiveChanges = [];
        // check if there is a CFN template in the current snapshot
        // that does not exist in the "actual" snapshot
        for (const [stackId, stack] of Object.entries(expected)) {
            for (const templateId of Object.keys(stack.templates)) {
                if (!actual[stackId]?.templates[templateId]) {
                    failures.push({
                        testName: this.testName,
                        stackName: templateId,
                        reason: common_1.DiagnosticReason.SNAPSHOT_FAILED,
                        message: `${templateId} exists in snapshot, but not in actual`,
                    });
                }
            }
        }
        for (const [stackId, stack] of Object.entries(actual)) {
            for (const templateId of Object.keys(stack.templates)) {
                // check if there is a CFN template in the "actual" snapshot
                // that does not exist in the current snapshot
                if (!expected[stackId]?.templates[templateId]) {
                    failures.push({
                        testName: this.testName,
                        stackName: templateId,
                        reason: common_1.DiagnosticReason.SNAPSHOT_FAILED,
                        message: `${templateId} does not exist in snapshot, but does in actual`,
                    });
                    continue;
                }
                else {
                    const config = {
                        diffAssets: this.actualTestSuite.getOptionsForStack(stackId)?.diffAssets,
                    };
                    let actualTemplate = actual[stackId].templates[templateId];
                    let expectedTemplate = expected[stackId].templates[templateId];
                    // if we are not verifying asset hashes then remove the specific
                    // asset hashes from the templates so they are not part of the diff
                    // comparison
                    if (!config.diffAssets) {
                        actualTemplate = this.canonicalizeTemplate(actualTemplate, actual[stackId].assets);
                        expectedTemplate = this.canonicalizeTemplate(expectedTemplate, expected[stackId].assets);
                    }
                    const templateDiff = (0, cloudformation_diff_1.fullDiff)(expectedTemplate, actualTemplate);
                    if (!templateDiff.isEmpty) {
                        const allowedDestroyTypes = this.getAllowedDestroyTypesForStack(stackId) ?? [];
                        // go through all the resource differences and check for any
                        // "destructive" changes
                        templateDiff.resources.forEachDifference((logicalId, change) => {
                            // if the change is a removal it will not show up as a 'changeImpact'
                            // so need to check for it separately, unless it is a resourceType that
                            // has been "allowed" to be destroyed
                            const resourceType = change.oldValue?.Type ?? change.newValue?.Type;
                            if (resourceType && allowedDestroyTypes.includes(resourceType)) {
                                return;
                            }
                            if (change.isRemoval) {
                                destructiveChanges.push({
                                    impact: cloudformation_diff_1.ResourceImpact.WILL_DESTROY,
                                    logicalId,
                                    stackName: templateId,
                                });
                            }
                            else {
                                switch (change.changeImpact) {
                                    case cloudformation_diff_1.ResourceImpact.MAY_REPLACE:
                                    case cloudformation_diff_1.ResourceImpact.WILL_ORPHAN:
                                    case cloudformation_diff_1.ResourceImpact.WILL_DESTROY:
                                    case cloudformation_diff_1.ResourceImpact.WILL_REPLACE:
                                        destructiveChanges.push({
                                            impact: change.changeImpact,
                                            logicalId,
                                            stackName: templateId,
                                        });
                                        break;
                                }
                            }
                        });
                        const writable = new StringWritable({});
                        (0, cloudformation_diff_1.formatDifferences)(writable, templateDiff);
                        failures.push({
                            reason: common_1.DiagnosticReason.SNAPSHOT_FAILED,
                            message: writable.data,
                            stackName: templateId,
                            testName: this.testName,
                            config,
                        });
                    }
                }
            }
        }
        return {
            diagnostics: failures,
            destructiveChanges,
        };
    }
    readAssembly(dir) {
        return cloud_assembly_1.AssemblyManifestReader.fromPath(dir);
    }
    /**
     * Reduce template to a normal form where asset references have been normalized
     *
     * This makes it possible to compare templates if all that's different between
     * them is the hashes of the asset values.
     */
    canonicalizeTemplate(template, assets) {
        const assetsSeen = new Set();
        const stringSubstitutions = new Array();
        // Find assets via parameters (for LegacyStackSynthesizer)
        const paramRe = /^AssetParameters([a-zA-Z0-9]{64})(S3Bucket|S3VersionKey|ArtifactHash)([a-zA-Z0-9]{8})$/;
        for (const paramName of Object.keys(template?.Parameters || {})) {
            const m = paramRe.exec(paramName);
            if (!m) {
                continue;
            }
            if (assetsSeen.has(m[1])) {
                continue;
            }
            assetsSeen.add(m[1]);
            const ix = assetsSeen.size;
            // Full parameter reference
            stringSubstitutions.push([
                new RegExp(`AssetParameters${m[1]}(S3Bucket|S3VersionKey|ArtifactHash)([a-zA-Z0-9]{8})`),
                `Asset${ix}$1`,
            ]);
            // Substring asset hash reference
            stringSubstitutions.push([
                new RegExp(`${m[1]}`),
                `Asset${ix}Hash`,
            ]);
        }
        // find assets defined in the asset manifest
        try {
            assets.forEach(asset => {
                if (!assetsSeen.has(asset)) {
                    assetsSeen.add(asset);
                    const ix = assetsSeen.size;
                    stringSubstitutions.push([
                        new RegExp(asset),
                        `Asset${ix}$1`,
                    ]);
                }
            });
        }
        catch {
            // if there is no asset manifest that is fine.
        }
        // Substitute them out
        return substitute(template);
        function substitute(what) {
            if (Array.isArray(what)) {
                return what.map(substitute);
            }
            if (typeof what === 'object' && what !== null) {
                const ret = {};
                for (const [k, v] of Object.entries(what)) {
                    ret[stringSub(k)] = substitute(v);
                }
                return ret;
            }
            if (typeof what === 'string') {
                return stringSub(what);
            }
            return what;
        }
        function stringSub(x) {
            for (const [re, replacement] of stringSubstitutions) {
                x = x.replace(re, replacement);
            }
            return x;
        }
    }
}
exports.IntegSnapshotRunner = IntegSnapshotRunner;
class StringWritable extends stream_1.Writable {
    constructor(options) {
        super(options);
        this._decoder = new string_decoder_1.StringDecoder();
        this.data = '';
    }
    _write(chunk, encoding, callback) {
        if (encoding === 'buffer') {
            chunk = this._decoder.write(chunk);
        }
        this.data += chunk;
        callback();
    }
    _final(callback) {
        this.data += this._decoder.end();
        callback();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic25hcHNob3QtdGVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzbmFwc2hvdC10ZXN0LXJ1bm5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2QkFBNkI7QUFFN0IsbUNBQWtDO0FBQ2xDLG1EQUErQztBQUUvQyxzRUFBMkY7QUFDM0YsNkRBQWtFO0FBRWxFLCtDQUFtRTtBQUVuRSw4Q0FBcUQ7QUFxQnJEOzs7R0FHRztBQUNILE1BQWEsbUJBQW9CLFNBQVEseUJBQVc7SUFDbEQsWUFBWSxPQUEyQjtRQUNyQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDakIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0ksWUFBWSxDQUFDLFVBQXVDLEVBQUU7UUFDM0QsSUFBSSxPQUFPLEdBQUcsSUFBSSxDQUFDO1FBQ25CLElBQUksQ0FBQztZQUNILE1BQU0sd0JBQXdCLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBRTVHLDZCQUE2QjtZQUM3Qix5REFBeUQ7WUFDekQsMkVBQTJFO1lBQzNFLDZFQUE2RTtZQUM3RSxvQ0FBb0M7WUFDcEMsTUFBTSxHQUFHLEdBQUc7Z0JBQ1YsR0FBRyxtQ0FBcUIsQ0FBQyxHQUFHO2dCQUM1QixnQkFBZ0IsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUM7b0JBQy9DLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLG1DQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRTtpQkFDM0UsQ0FBQyxDQUFDO2FBQ0osQ0FBQztZQUNGLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDO2dCQUNqQixPQUFPLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDO2dCQUMvQixHQUFHO2dC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QUFDLFFBQXdDO1FBQzdDLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUNqQyxRQUFRLEVBQUUsQ0FBQztJQUNiLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgdHlwZSB7IFdyaXRhYmxlT3B0aW9ucyB9IGZyb20gJ3N0cmVhbSc7XG5pbXBvcnQgeyBXcml0YWJsZSB9IGZyb20gJ3N0cmVhbSc7XG5pbXBvcnQgeyBTdHJpbmdEZWNvZGVyIH0gZnJvbSAnc3RyaW5nX2RlY29kZXInO1xuaW1wb3J0IHR5cGUgeyBSZXNvdXJjZURpZmZlcmVuY2UgfSBmcm9tICdAYXdzLWNkay9jbG91ZGZvcm1hdGlvbi1kaWZmJztcbmltcG9ydCB7IGZ1bGxEaWZmLCBmb3JtYXREaWZmZXJlbmNlcywgUmVzb3VyY2VJbXBhY3QgfSBmcm9tICdAYXdzLWNkay9jbG91ZGZvcm1hdGlvbi1kaWZmJztcbmltcG9ydCB7IEFzc2VtYmx5TWFuaWZlc3RSZWFkZXIgfSBmcm9tICcuL3ByaXZhdGUvY2xvdWQtYXNzZW1ibHknO1xuaW1wb3J0IHR5cGUgeyBJbnRlZ1J1bm5lck9wdGlvbnMgfSBmcm9tICcuL3J1bm5lci1iYXNlJztcbmltcG9ydCB7IEludGVnUnVubmVyLCBERUZBVUxUX1NZTlRIX09QVElPTlMgfSBmcm9tICcuL3J1bm5lci1iYXNlJztcbmltcG9ydCB0eXBlIHsgRGlhZ25vc3RpYywgRGVzdHJ1Y3RpdmVDaGFuZ2UsIFNuYXBzaG90VmVyaWZpY2F0aW9uT3B0aW9ucyB9IGZyb20gJy4uL3dvcmtlcnMvY29tbW9uJztcbmltcG9ydCB7IERpYWdub3N0aWNSZWFzb24gfSBmcm9tICcuLi93b3JrZXJzL2NvbW1vbic7XG5cbmludGVyZmFjZSBTbmFwc2hvdEFzc2VtYmx5IHtcbiAgLyoqXG4gICAqIE1hcCBvZiBzdGFja3MgdGhhdCBhcmUgcGFydCBvZiB0aGlzIGFzc2VtYmx5XG4gICAqL1xuICBbc3RhY2tOYW1lOiBzdHJpbmddOiB7XG4gICAgLyoqXG4gICAgICogQWxsIHRlbXBsYXRlcyBmb3IgdGhpcyBzdGFjaywgaW5jbHVkaW5nIG5lc3RlZCBzdGFja3NcbiAgICAgKi9cbiAgICB0ZW1wbGF0ZXM6IHtcbiAgICAgIFt0ZW1wbGF0ZUlkOiBzdHJpbmddOiBhbnk7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIExpc3Qgb2YgYXNzZXQgSWRzIHRoYXQgYXJlIHVzZWQgYnkgdGhpcyBhc3NlbWJseVxuICAgICAqL1xuICAgIGFzc2V0czogc3RyaW5nW107XG4gIH07XG59XG5cbi8qKlxuICogUnVubmVyIGZvciBzbmFwc2hvdCB0ZXN0cy4gVGhpcyBoYW5kbGVzIG9yY2hlc3RyYXRpbmdcbiAqIHRoZSB2YWxpZGF0aW9uIG9mIHRoZSBpbnRlZ3JhdGlvbiB0ZXN0IHNuYXBzaG90c1xuICovXG5leHBvcnQgY2xhc3MgSW50ZWdTbmFwc2hvdFJ1bm5lciBleHRlbmRzIEludGVnUnVubmVyIHtcbiAgY29uc3RydWN0b3Iob3B0aW9uczogSW50ZWdSdW5uZXJPcHRpb25zKSB7XG4gICAgc3VwZXIob3B0aW9ucyk7XG4gIH1cblxuICAvKipcbiAgICogU3ludGggdGhlIGludGVncmF0aW9uIHRlc3RzIGFuZCBjb21wYXJlIHRoZSB0ZW1wbGF0ZXNcbiAgICogdG8gdGhlIGV4aXN0aW5nIHNuYXBzaG90LlxuICAgKlxuICAgKiBAcmV0dXJucyBhbnkgZGlhZ25vc3RpY3MgYW5kIGFueSBkZXN0cnVjdGl2ZSBjaGFuZ2VzXG4gICAqL1xuICBwdWJsaWMgdGVzdFNuYXBzaG90KG9wdGlvbnM6IFNuYXBzaG90VmVyaWZpY2F0aW9uT3B0aW9ucyA9IHt9KTogeyBkaWFnbm9zdGljczogRGlhZ25vc3RpY1tdOyBkZXN0cnVjdGl2ZUNoYW5nZXM6IERlc3RydWN0aXZlQ2hhbmdlW10gfSB7XG4gICAgbGV0IGRvQ2xlYW4gPSB0cnVlO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBleHBlY3RlZFNuYXBzaG90QXNzZW1ibHkgPSB0aGlzLmdldFNuYXBzaG90QXNzZW1ibHkodGhpcy5zbmFwc2hvdERpciwgdGhpcy5leHBlY3RlZFRlc3RTdWl0ZT8uc3RhY2tzKTtcblxuICAgICAgLy8gc3ludGggdGhlIGludGVncmF0aW9uIHRlc3RcbiAgICAgIC8vIEZJWE1FOiBpZGVhbGx5IHdlIHNob3VsZCBub3QgbmVlZCB0byBydW4gdGhpcyBhZ2FpbiBpZlxuICAgICAgLy8gdGhlIGNka091dERpciBleGlzdHMgYWxyZWFkeSwgYnV0IGZvciBzb21lIHJlYXNvbiBnZW5lcmF0ZUFjdHVhbFNuYXBzaG90XG4gICAgICAvLyBnZW5lcmF0ZXMgYW4gaW5jb3JyZWN0IHNuYXBzaG90IGFuZCBJIGhhdmUgbm8gaWRlYSB3aHkgc28gc3ludGggYWdhaW4gaGVyZVxuICAgICAgLy8gdG8gcHJvZHVjZSB0aGUgXCJjb3JyZWN0XCIgc25hcHNob3RcbiAgICAgIGNvbnN0IGVudiA9IHtcbiAgICAgICAgLi4uREVGQVVMVF9TWU5USF9PUFRJT05TLmVudixcbiAgICAgICAgQ0RLX0NPTlRFWFRfSlNPTjogSlNPTi5zdHJpbmdpZnkodGhpcy5nZXRDb250ZXh0KHtcbiAgICAgICAgICAuLi50aGlzLmFjdHVhbFRlc3RTdWl0ZS5lbmFibGVMb29rdXBzID8gREVGQVVMVF9TWU5USF9PUFRJT05TLmNvbnRleHQgOiB7fSxcbiAgICAgICAgfSkpLFxuICAgICAgfTtcbiAgICAgIHRoaXMuY2RrLnN5bnRoRmFzdCh7XG4gICAgICAgIGV4ZWNDbWQ6IHRoaXMuY2RrQXBwLnNwbGl0KCcgJyksXG4gICAgICAgIGVudixcbiAgICAgICAgb3V0cHV0OiBwYXRoLnJlbGF0aXZlKHRoaXMuZGlyZWN0b3J5LCB0aGlzLmNka091dERpciksXG4gICAgICB9KTtcblxuICAgICAgLy8gcmVhZCB0aGUgXCJhY3R1YWxcIiBzbmFwc2hvdFxuICAgICAgY29uc3QgYWN0dWFsU25hcHNob3RBc3NlbWJseSA9IHRoaXMuZ2V0U25hcHNob3RBc3NlbWJseSh0aGlzLmNka091dERpciwgdGhpcy5hY3R1YWxUZXN0U3VpdGUuc3RhY2tzKTtcblxuICAgICAgLy8gZGlmZiB0aGUgZXhpc3Rpbmcgc25hcHNob3QgKGV4cGVjdGVkKSB3aXRoIHRoZSBpbnRlZ3JhdGlvbiB0ZXN0IChhY3R1YWwpXG4gICAgICBjb25zdCBkaWFnbm9zdGljcyA9IHRoaXMuZGlmZkFzc2VtYmx5KGV4cGVjdGVkU25hcHNob3RBc3NlbWJseSwgYWN0dWFsU25hcHNob3RBc3NlbWJseSk7XG5cbiAgICAgIGlmIChkaWFnbm9zdGljcy5kaWFnbm9zdGljcy5sZW5ndGgpIHtcbiAgICAgICAgLy8gQXR0YWNoIGFkZGl0aW9uYWwgbWVzc2FnZXMgdG8gdGhlIGZpcnN0IGRpYWdub3N0aWNcbiAgICAgICAgY29uc3QgYWRkaXRpb25hbE1lc3NhZ2VzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgICAgIGlmIChvcHRpb25zLnJldGFpbikge1xuICAgICAgICAgIGFkZGl0aW9uYWxNZXNzYWdlcy5wdXNoKFxuICAgICAgICAgICAgYChGYWlsdXJlIHJldGFpbmVkKSBFeHBlY3RlZDogJHtwYXRoLnJlbGF0aXZlKHByb2Nlc3MuY3dkKCksIHRoaXMuc25hcHNob3REaXIpfWAsXG4gICAgICAgICAgICBgICAgICAgICAgICAgICAgICAgIEFjdHVhbDogICAke3BhdGgucmVsYXRpdmUocHJvY2Vzcy5jd2QoKSwgdGhpcy5jZGtPdXREaXIpfWAsXG4gICAgICAgICAgKSxcbiAgICAgICAgICBkb0NsZWFuID0gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAob3B0aW9ucy52ZXJib3NlKSB7XG4gICAgICAgICAgLy8gU2hvdyB0aGUgY29tbWFuZCBuZWNlc3NhcnkgdG8gcmVwcm8gdGhpc1xuICAgICAgICAgIGNvbnN0IGVudlNldCA9IE9iamVjdC5lbnRyaWVzKGVudilcbiAgICAgICAgICAgIC5maWx0ZXIoKFtrLCBfXSkgPT4gayAhPT0gJ0NES19DT05URVhUX0pTT04nKVxuICAgICAgICAgICAgLm1hcCgoW2ssIHZdKSA9PiBgJHtrfT0nJHt2fSdgKTtcbiAgICAgICAgICBjb25zdCBlbnZDbWQgPSBlbnZTZXQubGVuZ3RoID4gMCA/IFsnZW52JywgLi4uZW52U2V0XSA6IFtdO1xuXG4gICAgICAgICAgYWRkaXRpb25hbE1lc3NhZ2VzLnB1c2goXG4gICAgICAgICAgICAnUmVwcm86JyxcbiAgICAgICAgICAgIGAgICR7Wy4uLmVudkNtZCwgJ2NkayBzeW50aCcsIGAtYSAnJHt0aGlzLmNka0FwcH0nYCwgYC1vICcke3RoaXMuY2RrT3V0RGlyfSdgLCAuLi5PYmplY3QuZW50cmllcyh0aGlzLmdldENvbnRleHQoKSkuZmxhdE1hcCgoW2ssIHZdKSA9PiB0eXBlb2YgdiAhPT0gJ29iamVjdCcgPyBbYC1jICcke2t9PSR7dn0nYF0gOiBbXSldLmpvaW4oJyAnKX1gLFxuXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRpYWdub3N0aWNzLmRpYWdub3N0aWNzWzBdID0ge1xuICAgICAgICAgIC4uLmRpYWdub3N0aWNzLmRpYWdub3N0aWNzWzBdLFxuICAgICAgICAgIGFkZGl0aW9uYWxNZXNzYWdlcyxcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRpYWdub3N0aWNzO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRocm93IGU7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChkb0NsZWFuKSB7XG4gICAgICAgIHRoaXMuY2xlYW51cCgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGb3IgYSBnaXZlbiBjbG91ZCBhc3NlbWJseSByZXR1cm4gYSBjb2xsZWN0aW9uIG9mIGFsbCB0ZW1wbGF0ZXNcbiAgICogdGhhdCBzaG91bGQgYmUgcGFydCBvZiB0aGUgc25hcHNob3QgYW5kIGFueSByZXF1aXJlZCBtZXRhIGRhdGEuXG4gICAqXG4gICAqIEBwYXJhbSBjbG91ZEFzc2VtYmx5RGlyIFRoZSBkaXJlY3Rvcnkgb2YgdGhlIGNsb3VkIGFzc2VtYmx5IHRvIGxvb2sgZm9yIHNuYXBzaG90c1xuICAgKiBAcGFyYW0gcGlja1N0YWNrcyBQaWNrIG9ubHkgdGhlc2Ugc3RhY2tzIGZyb20gdGhlIGNsb3VkIGFzc2VtYmx5XG4gICAqIEByZXR1cm5zIEEgU25hcHNob3RBc3NlbWJseSwgdGhlIGNvbGxlY3Rpb24gb2YgYWxsIHRlbXBsYXRlcyBpbiB0aGlzIHNuYXBzaG90IGFuZCByZXF1aXJlZCBtZXRhIGRhdGFcbiAgICovXG4gIHByaXZhdGUgZ2V0U25hcHNob3RBc3NlbWJseShjbG91ZEFzc2VtYmx5RGlyOiBzdHJpbmcsIHBpY2tTdGFja3M6IHN0cmluZ1tdID0gW10pOiBTbmFwc2hvdEFzc2VtYmx5IHtcbiAgICBjb25zdCBhc3NlbWJseSA9IHRoaXMucmVhZEFzc2VtYmx5KGNsb3VkQXNzZW1ibHlEaXIpO1xuICAgIGNvbnN0IHN0YWNrcyA9IGFzc2VtYmx5LnN0YWNrcztcbiAgICBjb25zdCBzbmFwc2hvdHM6IFNuYXBzaG90QXNzZW1ibHkgPSB7fTtcbiAgICBmb3IgKGNvbnN0IFtzdGFja05hbWUsIHN0YWNrVGVtcGxhdGVdIG9mIE9iamVjdC5lbnRyaWVzKHN0YWNrcykpIHtcbiAgICAgIGlmIChwaWNrU3RhY2tzLmluY2x1ZGVzKHN0YWNrTmFtZSkpIHtcbiAgICAgICAgY29uc3QgbWFuaWZlc3QgPSBBc3NlbWJseU1hbmlmZXN0UmVhZGVyLmZyb21QYXRoKGNsb3VkQXNzZW1ibHlEaXIpO1xuICAgICAgICBjb25zdCBhc3NldHMgPSBtYW5pZmVzdC5nZXRBc3NldElkc0ZvclN0YWNrKHN0YWNrTmFtZSk7XG5cbiAgICAgICAgc25hcHNob3RzW3N0YWNrTmFtZV0gPSB7XG4gICAgICAgICAgdGVtcGxhdGVzOiB7XG4gICAgICAgICAgICBbc3RhY2tOYW1lXTogc3RhY2tUZW1wbGF0ZSxcbiAgICAgICAgICAgIC4uLmFzc2VtYmx5LmdldE5lc3RlZFN0YWNrc0ZvclN0YWNrKHN0YWNrTmFtZSksXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhc3NldHMsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNuYXBzaG90cztcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3IgYSBnaXZlbiBzdGFjayByZXR1cm4gYWxsIHJlc291cmNlIHR5cGVzIHRoYXQgYXJlIGFsbG93ZWQgdG8gYmUgZGVzdHJveWVkXG4gICAqIGFzIHBhcnQgb2YgYSBzdGFjayB1cGRhdGVcbiAgICpcbiAgICogQHBhcmFtIHN0YWNrSWQgdGhlIHN0YWNrIGlkXG4gICAqIEByZXR1cm5zIGEgbGlzdCBvZiByZXNvdXJjZSB0eXBlcyBvciB1bmRlZmluZWQgaWYgbm9uZSBhcmUgZm91bmRcbiAgICovXG4gIHByaXZhdGUgZ2V0QWxsb3dlZERlc3Ryb3lUeXBlc0ZvclN0YWNrKHN0YWNrSWQ6IHN0cmluZyk6IHN0cmluZ1tdIHwgdW5kZWZpbmVkIHtcbiAgICBmb3IgKGNvbnN0IHRlc3RDYXNlIG9mIE9iamVjdC52YWx1ZXModGhpcy5hY3R1YWxUZXN0cygpID8/IHt9KSkge1xuICAgICAgaWYgKHRlc3RDYXNlLnN0YWNrcy5pbmNsdWRlcyhzdGFja0lkKSkge1xuICAgICAgICByZXR1cm4gdGVzdENhc2UuYWxsb3dEZXN0cm95O1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIEZpbmQgYW55IGRpZmZlcmVuY2VzIGJldHdlZW4gdGhlIGV4aXN0aW5nIGFuZCBleHBlY3RlZCBzbmFwc2hvdHNcbiAgICpcbiAgICogQHBhcmFtIGV4aXN0aW5nIC0gdGhlIGV4aXN0aW5nIChleHBlY3RlZCkgc25hcHNob3RcbiAgICogQHBhcmFtIGFjdHVhbCAtIHRoZSBuZXcgKGFjdHVhbCkgc25hcHNob3RcbiAgICogQHJldHVybnMgYW55IGRpYWdub3N0aWNzIGFuZCBhbnkgZGVzdHJ1Y3RpdmUgY2hhbmdlc1xuICAgKi9cbiAgcHJpdmF0ZSBkaWZmQXNzZW1ibHkoXG4gICAgZXhwZWN0ZWQ6IFNuYXBzaG90QXNzZW1ibHksXG4gICAgYWN0dWFsOiBTbmFwc2hvdEFzc2VtYmx5LFxuICApOiB7IGRpYWdub3N0aWNzOiBEaWFnbm9zdGljW107IGRlc3RydWN0aXZlQ2hhbmdlczogRGVzdHJ1Y3RpdmVDaGFuZ2VbXSB9IHtcbiAgICBjb25zdCBmYWlsdXJlczogRGlhZ25vc3RpY1tdID0gW107XG4gICAgY29uc3QgZGVzdHJ1Y3RpdmVDaGFuZ2VzOiBEZXN0cnVjdGl2ZUNoYW5nZVtdID0gW107XG5cbiAgICAvLyBjaGVjayBpZiB0aGVyZSBpcyBhIENGTiB0ZW1wbGF0ZSBpbiB0aGUgY3VycmVudCBzbmFwc2hvdFxuICAgIC8vIHRoYXQgZG9lcyBub3QgZXhpc3QgaW4gdGhlIFwiYWN0dWFsXCIgc25hcHNob3RcbiAgICBmb3IgKGNvbnN0IFtzdGFja0lkLCBzdGFja10gb2YgT2JqZWN0LmVudHJpZXMoZXhwZWN0ZWQpKSB7XG4gICAgICBmb3IgKGNvbnN0IHRlbXBsYXRlSWQgb2YgT2JqZWN0LmtleXMoc3RhY2sudGVtcGxhdGVzKSkge1xuICAgICAgICBpZiAoIWFjdHVhbFtzdGFja0lkXT8udGVtcGxhdGVzW3RlbXBsYXRlSWRdKSB7XG4gICAgICAgICAgZmFpbHVyZXMucHVzaCh7XG4gICAgICAgICAgICB0ZXN0TmFtZTogdGhpcy50ZXN0TmFtZSxcbiAgICAgICAgICAgIHN0YWNrTmFtZTogdGVtcGxhdGVJZCxcbiAgICAgICAgICAgIHJlYXNvbjogRGlhZ25vc3RpY1JlYXNvbi5TTkFQU0hPVF9GQUlMRUQsXG4gICAgICAgICAgICBtZXNzYWdlOiBgJHt0ZW1wbGF0ZUlkfSBleGlzdHMgaW4gc25hcHNob3QsIGJ1dCBub3QgaW4gYWN0dWFsYCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW3N0YWNrSWQsIHN0YWNrXSBvZiBPYmplY3QuZW50cmllcyhhY3R1YWwpKSB7XG4gICAgICBmb3IgKGNvbnN0IHRlbXBsYXRlSWQgb2YgT2JqZWN0LmtleXMoc3RhY2sudGVtcGxhdGVzKSkge1xuICAgICAgLy8gY2hlY2sgaWYgdGhlcmUgaXMgYSBDRk4gdGVtcGxhdGUgaW4gdGhlIFwiYWN0dWFsXCIgc25hcHNob3RcbiAgICAgIC8vIHRoYXQgZG9lcyBub3QgZXhpc3QgaW4gdGhlIGN1cnJlbnQgc25hcHNob3RcbiAgICAgICAgaWYgKCFleHBlY3RlZFtzdGFja0lkXT8udGVtcGxhdGVzW3RlbXBsYXRlSWRdKSB7XG4gICAgICAgICAgZmFpbHVyZXMucHVzaCh7XG4gICAgICAgICAgICB0ZXN0TmFtZTogdGhpcy50ZXN0TmFtZSxcbiAgICAgICAgICAgIHN0YWNrTmFtZTogdGVtcGxhdGVJZCxcbiAgICAgICAgICAgIHJlYXNvbjogRGlhZ25vc3RpY1JlYXNvbi5TTkFQU0hPVF9GQUlMRUQsXG4gICAgICAgICAgICBtZXNzYWdlOiBgJHt0ZW1wbGF0ZUlkfSBkb2VzIG5vdCBleGlzdCBpbiBzbmFwc2hvdCwgYnV0IGRvZXMgaW4gYWN0dWFsYCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBjb25maWcgPSB7XG4gICAgICAgICAgICBkaWZmQXNzZXRzOiB0aGlzLmFjdHVhbFRlc3RTdWl0ZS5nZXRPcHRpb25zRm9yU3RhY2soc3RhY2tJZCk/LmRpZmZBc3NldHMsXG4gICAgICAgICAgfTtcbiAgICAgICAgICBsZXQgYWN0dWFsVGVtcGxhdGUgPSBhY3R1YWxbc3RhY2tJZF0udGVtcGxhdGVzW3RlbXBsYXRlSWRdO1xuICAgICAgICAgIGxldCBleHBlY3RlZFRlbXBsYXRlID0gZXhwZWN0ZWRbc3RhY2tJZF0udGVtcGxhdGVzW3RlbXBsYXRlSWRdO1xuXG4gICAgICAgICAgLy8gaWYgd2UgYXJlIG5vdCB2ZXJpZnlpbmcgYXNzZXQgaGFzaGVzIHRoZW4gcmVtb3ZlIHRoZSBzcGVjaWZpY1xuICAgICAgICAgIC8vIGFzc2V0IGhhc2hlcyBmcm9tIHRoZSB0ZW1wbGF0ZXMgc28gdGhleSBhcmUgbm90IHBhcnQgb2YgdGhlIGRpZmZcbiAgICAgICAgICAvLyBjb21wYXJpc29uXG4gICAgICAgICAgaWYgKCFjb25maWcuZGlmZkFzc2V0cykge1xuICAgICAgICAgICAgYWN0dWFsVGVtcGxhdGUgPSB0aGlzLmNhbm9uaWNhbGl6ZVRlbXBsYXRlKGFjdHVhbFRlbXBsYXRlLCBhY3R1YWxbc3RhY2tJZF0uYXNzZXRzKTtcbiAgICAgICAgICAgIGV4cGVjdGVkVGVtcGxhdGUgPSB0aGlzLmNhbm9uaWNhbGl6ZVRlbXBsYXRlKGV4cGVjdGVkVGVtcGxhdGUsIGV4cGVjdGVkW3N0YWNrSWRdLmFzc2V0cyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IHRlbXBsYXRlRGlmZiA9IGZ1bGxEaWZmKGV4cGVjdGVkVGVtcGxhdGUsIGFjdHVhbFRlbXBsYXRlKTtcbiAgICAgICAgICBpZiAoIXRlbXBsYXRlRGlmZi5pc0VtcHR5KSB7XG4gICAgICAgICAgICBjb25zdCBhbGxvd2VkRGVzdHJveVR5cGVzID0gdGhpcy5nZXRBbGxvd2VkRGVzdHJveVR5cGVzRm9yU3RhY2soc3RhY2tJZCkgPz8gW107XG5cbiAgICAgICAgICAgIC8vIGdvIHRocm91Z2ggYWxsIHRoZSByZXNvdXJjZSBkaWZmZXJlbmNlcyBhbmQgY2hlY2sgZm9yIGFueVxuICAgICAgICAgICAgLy8gXCJkZXN0cnVjdGl2ZVwiIGNoYW5nZXNcbiAgICAgICAgICAgIHRlbXBsYXRlRGlmZi5yZXNvdXJjZXMuZm9yRWFjaERpZmZlcmVuY2UoKGxvZ2ljYWxJZDogc3RyaW5nLCBjaGFuZ2U6IFJlc291cmNlRGlmZmVyZW5jZSkgPT4ge1xuICAgICAgICAgICAgLy8gaWYgdGhlIGNoYW5nZSBpcyBhIHJlbW92YWwgaXQgd2lsbCBub3Qgc2hvdyB1cCBhcyBhICdjaGFuZ2VJbXBhY3QnXG4gICAgICAgICAgICAvLyBzbyBuZWVkIHRvIGNoZWNrIGZvciBpdCBzZXBhcmF0ZWx5LCB1bmxlc3MgaXQgaXMgYSByZXNvdXJjZVR5cGUgdGhhdFxuICAgICAgICAgICAgLy8gaGFzIGJlZW4gXCJhbGxvd2VkXCIgdG8gYmUgZGVzdHJveWVkXG4gICAgICAgICAgICAgIGNvbnN0IHJlc291cmNlVHlwZSA9IGNoYW5nZS5vbGRWYWx1ZT8uVHlwZSA/PyBjaGFuZ2UubmV3VmFsdWU/LlR5cGU7XG4gICAgICAgICAgICAgIGlmIChyZXNvdXJjZVR5cGUgJiYgYWxsb3dlZERlc3Ryb3lUeXBlcy5pbmNsdWRlcyhyZXNvdXJjZVR5cGUpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmIChjaGFuZ2UuaXNSZW1vdmFsKSB7XG4gICAgICAgICAgICAgICAgZGVzdHJ1Y3RpdmVDaGFuZ2VzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgaW1wYWN0OiBSZXNvdXJjZUltcGFjdC5XSUxMX0RFU1RST1ksXG4gICAgICAgICAgICAgICAgICBsb2dpY2FsSWQsXG4gICAgICAgICAgICAgICAgICBzdGFja05hbWU6IHRlbXBsYXRlSWQsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc3dpdGNoIChjaGFuZ2UuY2hhbmdlSW1wYWN0KSB7XG4gICAgICAgICAgICAgICAgICBjYXNlIFJlc291cmNlSW1wYWN0Lk1BWV9SRVBMQUNFOlxuICAgICAgICAgICAgICAgICAgY2FzZSBSZXNvdXJjZUltcGFjdC5XSUxMX09SUEhBTjpcbiAgICAgICAgICAgICAgICAgIGNhc2UgUmVzb3VyY2VJbXBhY3QuV0lMTF9ERVNUUk9ZOlxuICAgICAgICAgICAgICAgICAgY2FzZSBSZXNvdXJjZUltcGFjdC5XSUxMX1JFUExBQ0U6XG4gICAgICAgICAgICAgICAgICAgIGRlc3RydWN0aXZlQ2hhbmdlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICBpbXBhY3Q6IGNoYW5nZS5jaGFuZ2VJbXBhY3QsXG4gICAgICAgICAgICAgICAgICAgICAgbG9naWNhbElkLFxuICAgICAgICAgICAgICAgICAgICAgIHN0YWNrTmFtZTogdGVtcGxhdGVJZCxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zdCB3cml0YWJsZSA9IG5ldyBTdHJpbmdXcml0YWJsZSh7fSk7XG4gICAgICAgICAgICBmb3JtYXREaWZmZXJlbmNlcyh3cml0YWJsZSwgdGVtcGxhdGVEaWZmKTtcbiAgICAgICAgICAgIGZhaWx1cmVzLnB1c2goe1xuICAgICAgICAgICAgICByZWFzb246IERpYWdub3N0aWNSZWFzb24uU05BUFNIT1RfRkFJTEVELFxuICAgICAgICAgICAgICBtZXNzYWdlOiB3cml0YWJsZS5kYXRhLFxuICAgICAgICAgICAgICBzdGFja05hbWU6IHRlbXBsYXRlSWQsXG4gICAgICAgICAgICAgIHRlc3ROYW1lOiB0aGlzLnRlc3ROYW1lLFxuICAgICAgICAgICAgICBjb25maWcsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGlhZ25vc3RpY3M6IGZhaWx1cmVzLFxuICAgICAgZGVzdHJ1Y3RpdmVDaGFuZ2VzLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRBc3NlbWJseShkaXI6IHN0cmluZyk6IEFzc2VtYmx5TWFuaWZlc3RSZWFkZXIge1xuICAgIHJldHVybiBBc3NlbWJseU1hbmlmZXN0UmVhZGVyLmZyb21QYXRoKGRpcik7XG4gIH1cblxuICAvKipcbiAgICogUmVkdWNlIHRlbXBsYXRlIHRvIGEgbm9ybWFsIGZvcm0gd2hlcmUgYXNzZXQgcmVmZXJlbmNlcyBoYXZlIGJlZW4gbm9ybWFsaXplZFxuICAgKlxuICAgKiBUaGlzIG1ha2VzIGl0IHBvc3NpYmxlIHRvIGNvbXBhcmUgdGVtcGxhdGVzIGlmIGFsbCB0aGF0J3MgZGlmZmVyZW50IGJldHdlZW5cbiAgICogdGhlbSBpcyB0aGUgaGFzaGVzIG9mIHRoZSBhc3NldCB2YWx1ZXMuXG4gICAqL1xuICBwcml2YXRlIGNhbm9uaWNhbGl6ZVRlbXBsYXRlKHRlbXBsYXRlOiBhbnksIGFzc2V0czogc3RyaW5nW10pOiBhbnkge1xuICAgIGNvbnN0IGFzc2V0c1NlZW4gPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBjb25zdCBzdHJpbmdTdWJzdGl0dXRpb25zID0gbmV3IEFycmF5PFtSZWdFeHAsIHN0cmluZ10+KCk7XG5cbiAgICAvLyBGaW5kIGFzc2V0cyB2aWEgcGFyYW1ldGVycyAoZm9yIExlZ2FjeVN0YWNrU3ludGhlc2l6ZXIpXG4gICAgY29uc3QgcGFyYW1SZSA9IC9eQXNzZXRQYXJhbWV0ZXJzKFthLXpBLVowLTldezY0fSkoUzNCdWNrZXR8UzNWZXJzaW9uS2V5fEFydGlmYWN0SGFzaCkoW2EtekEtWjAtOV17OH0pJC87XG4gICAgZm9yIChjb25zdCBwYXJhbU5hbWUgb2YgT2JqZWN0LmtleXModGVtcGxhdGU/LlBhcmFtZXRlcnMgfHwge30pKSB7XG4gICAgICBjb25zdCBtID0gcGFyYW1SZS5leGVjKHBhcmFtTmFtZSk7XG4gICAgICBpZiAoIW0pIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYXNzZXRzU2Vlbi5oYXMobVsxXSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGFzc2V0c1NlZW4uYWRkKG1bMV0pO1xuICAgICAgY29uc3QgaXggPSBhc3NldHNTZWVuLnNpemU7XG5cbiAgICAgIC8vIEZ1bGwgcGFyYW1ldGVyIHJlZmVyZW5jZVxuICAgICAgc3RyaW5nU3Vic3RpdHV0aW9ucy5wdXNoKFtcbiAgICAgICAgbmV3IFJlZ0V4cChgQXNzZXRQYXJhbWV0ZXJzJHttWzFdfShTM0J1Y2tldHxTM1ZlcnNpb25LZXl8QXJ0aWZhY3RIYXNoKShbYS16QS1aMC05XXs4fSlgKSxcbiAgICAgICAgYEFzc2V0JHtpeH0kMWAsXG4gICAgICBdKTtcbiAgICAgIC8vIFN1YnN0cmluZyBhc3NldCBoYXNoIHJlZmVyZW5jZVxuICAgICAgc3RyaW5nU3Vic3RpdHV0aW9ucy5wdXNoKFtcbiAgICAgICAgbmV3IFJlZ0V4cChgJHttWzFdfWApLFxuICAgICAgICBgQXNzZXQke2l4fUhhc2hgLFxuICAgICAgXSk7XG4gICAgfVxuXG4gICAgLy8gZmluZCBhc3NldHMgZGVmaW5lZCBpbiB0aGUgYXNzZXQgbWFuaWZlc3RcbiAgICB0cnkge1xuICAgICAgYXNzZXRzLmZvckVhY2goYXNzZXQgPT4ge1xuICAgICAgICBpZiAoIWFzc2V0c1NlZW4uaGFzKGFzc2V0KSkge1xuICAgICAgICAgIGFzc2V0c1NlZW4uYWRkKGFzc2V0KTtcbiAgICAgICAgICBjb25zdCBpeCA9IGFzc2V0c1NlZW4uc2l6ZTtcbiAgICAgICAgICBzdHJpbmdTdWJzdGl0dXRpb25zLnB1c2goW1xuICAgICAgICAgICAgbmV3IFJlZ0V4cChhc3NldCksXG4gICAgICAgICAgICBgQXNzZXQke2l4fSQxYCxcbiAgICAgICAgICBdKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBpZiB0aGVyZSBpcyBubyBhc3NldCBtYW5pZmVzdCB0aGF0IGlzIGZpbmUuXG4gICAgfVxuXG4gICAgLy8gU3Vic3RpdHV0ZSB0aGVtIG91dFxuICAgIHJldHVybiBzdWJzdGl0dXRlKHRlbXBsYXRlKTtcblxuICAgIGZ1bmN0aW9uIHN1YnN0aXR1dGUod2hhdDogYW55KTogYW55IHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHdoYXQpKSB7XG4gICAgICAgIHJldHVybiB3aGF0Lm1hcChzdWJzdGl0dXRlKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiB3aGF0ID09PSAnb2JqZWN0JyAmJiB3aGF0ICE9PSBudWxsKSB7XG4gICAgICAgIGNvbnN0IHJldDogYW55ID0ge307XG4gICAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKHdoYXQpKSB7XG4gICAgICAgICAgcmV0W3N0cmluZ1N1YihrKV0gPSBzdWJzdGl0dXRlKHYpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXQ7XG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2Ygd2hhdCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuIHN0cmluZ1N1Yih3aGF0KTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHdoYXQ7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3RyaW5nU3ViKHg6IHN0cmluZykge1xuICAgICAgZm9yIChjb25zdCBbcmUsIHJlcGxhY2VtZW50XSBvZiBzdHJpbmdTdWJzdGl0dXRpb25zKSB7XG4gICAgICAgIHggPSB4LnJlcGxhY2UocmUsIHJlcGxhY2VtZW50KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB4O1xuICAgIH1cbiAgfVxufVxuXG5jbGFzcyBTdHJpbmdXcml0YWJsZSBleHRlbmRzIFdyaXRhYmxlIHtcbiAgcHVibGljIGRhdGE6IHN0cmluZztcbiAgcHJpdmF0ZSBfZGVjb2RlcjogU3RyaW5nRGVjb2RlcjtcbiAgY29uc3RydWN0b3Iob3B0aW9uczogV3JpdGFibGVPcHRpb25zKSB7XG4gICAgc3VwZXIob3B0aW9ucyk7XG4gICAgdGhpcy5fZGVjb2RlciA9IG5ldyBTdHJpbmdEZWNvZGVyKCk7XG4gICAgdGhpcy5kYXRhID0gJyc7XG4gIH1cblxuICBfd3JpdGUoY2h1bms6IGFueSwgZW5jb2Rpbmc6IHN0cmluZywgY2FsbGJhY2s6IChlcnJvcj86IEVycm9yIHwgbnVsbCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIGlmIChlbmNvZGluZyA9PT0gJ2J1ZmZlcicpIHtcbiAgICAgIGNodW5rID0gdGhpcy5fZGVjb2Rlci53cml0ZShjaHVuayk7XG4gICAgfVxuXG4gICAgdGhpcy5kYXRhICs9IGNodW5rO1xuICAgIGNhbGxiYWNrKCk7XG4gIH1cblxuICBfZmluYWwoY2FsbGJhY2s6IChlcnJvcj86IEVycm9yIHwgbnVsbCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMuZGF0YSArPSB0aGlzLl9kZWNvZGVyLmVuZCgpO1xuICAgIGNhbGxiYWNrKCk7XG4gIH1cbn1cbiJdfQ==