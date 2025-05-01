"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BootstrapStack = void 0;
exports.bootstrapVersionFromTemplate = bootstrapVersionFromTemplate;
exports.bootstrapVariantFromTemplate = bootstrapVariantFromTemplate;
const os = require("os");
const path = require("path");
const cloud_assembly_schema_1 = require("@aws-cdk/cloud-assembly-schema");
const cx_api_1 = require("@aws-cdk/cx-api");
const fs = require("fs-extra");
const bootstrap_props_1 = require("./bootstrap-props");
const deployments_1 = require("../deployments");
const deploy_stack_1 = require("../deployments/deploy-stack");
const environment_1 = require("../environment");
const private_1 = require("../io/private");
const plugin_1 = require("../plugin");
const toolkit_info_1 = require("../toolkit-info");
/**
 * A class to hold state around stack bootstrapping
 *
 * This class exists so we can break bootstrapping into 2 phases:
 *
 * ```ts
 * const current = BootstrapStack.lookup(...);
 * // ...
 * current.update(newTemplate, ...);
 * ```
 *
 * And do something in between the two phases (such as look at the
 * current bootstrap stack and doing something intelligent).
 */
class BootstrapStack {
    sdkProvider;
    sdk;
    resolvedEnvironment;
    toolkitStackName;
    currentToolkitInfo;
    ioHelper;
    static async lookup(sdkProvider, environment, toolkitStackName, ioHelper) {
        toolkitStackName = toolkitStackName ?? toolkit_info_1.DEFAULT_TOOLKIT_STACK_NAME;
        const resolvedEnvironment = await sdkProvider.resolveEnvironment(environment);
        const sdk = (await sdkProvider.forEnvironment(resolvedEnvironment, plugin_1.Mode.ForWriting)).sdk;
        const currentToolkitInfo = await toolkit_info_1.ToolkitInfo.lookup(resolvedEnvironment, sdk, ioHelper, toolkitStackName);
        return new BootstrapStack(sdkProvider, sdk, resolvedEnvironment, toolkitStackName, currentToolkitInfo, ioHelper);
    }
    constructor(sdkProvider, sdk, resolvedEnvironment, toolkitStackName, currentToolkitInfo, ioHelper) {
        this.sdkProvider = sdkProvider;
        this.sdk = sdk;
        this.resolvedEnvironment = resolvedEnvironment;
        this.toolkitStackName = toolkitStackName;
        this.currentToolkitInfo = currentToolkitInfo;
        this.ioHelper = ioHelper;
    }
    get parameters() {
        return this.currentToolkitInfo.found ? this.currentToolkitInfo.bootstrapStack.parameters : {};
    }
    get terminationProtection() {
        return this.currentToolkitInfo.found ? this.currentToolkitInfo.bootstrapStack.terminationProtection : undefined;
    }
    async partition() {
        return (await this.sdk.currentAccount()).partition;
    }
    /**
     * Perform the actual deployment of a bootstrap stack, given a template and some parameters
     */
    async update(template, parameters, options) {
        if (this.currentToolkitInfo.found && !options.forceDeployment) {
            // Safety checks
            const abortResponse = {
                type: 'did-deploy-stack',
                noOp: true,
                outputs: {},
                stackArn: this.currentToolkitInfo.bootstrapStack.stackId,
            };
            // Validate that the bootstrap stack we're trying to replace is from the same variant as the one we're trying to deploy
            const currentVariant = this.currentToolkitInfo.variant;
            const newVariant = bootstrapVariantFromTemplate(template);
            if (currentVariant !== newVariant) {
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg(`Bootstrap stack already exists, containing '${currentVariant}'. Not overwriting it with a template containing '${newVariant}' (use --force if you intend to overwrite)`));
                return abortResponse;
            }
            // Validate that we're not downgrading the bootstrap stack
            const newVersion = bootstrapVersionFromTemplate(template);
            const currentVersion = this.currentToolkitInfo.version;
            if (newVersion < currentVersion) {
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg(`Bootstrap stack already at version ${currentVersion}. Not downgrading it to version ${newVersion} (use --force if you intend to downgrade)`));
                if (newVersion === 0) {
                    // A downgrade with 0 as target version means we probably have a new-style bootstrap in the account,
                    // and an old-style bootstrap as current target, which means the user probably forgot to put this flag in.
                    await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg("(Did you set the '@aws-cdk/core:newStyleStackSynthesis' feature flag in cdk.json?)"));
                }
                return abortResponse;
            }
        }
        const outdir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk-bootstrap'));
        const builder = new cx_api_1.CloudAssemblyBuilder(outdir);
        const templateFile = `${this.toolkitStackName}.template.json`;
        await fs.writeJson(path.join(builder.outdir, templateFile), template, {
            spaces: 2,
        });
        builder.addArtifact(this.toolkitStackName, {
            type: cloud_assembly_schema_1.ArtifactType.AWS_CLOUDFORMATION_STACK,
            environment: cx_api_1.EnvironmentUtils.format(this.resolvedEnvironment.account, this.resolvedEnvironment.region),
            properties: {
                templateFile,
                terminationProtection: options.terminationProtection ?? false,
            },
        });
        const assembly = builder.buildAssembly();
        const ret = await (0, deploy_stack_1.deployStack)({
            stack: assembly.getStackByName(this.toolkitStackName),
            resolvedEnvironment: this.resolvedEnvironment,
            sdk: this.sdk,
            sdkProvider: this.sdkProvider,
            forceDeployment: options.forceDeployment,
            roleArn: options.roleArn,
            tags: options.tags,
            deploymentMethod: { method: 'change-set', execute: options.execute },
            parameters,
            usePreviousParameters: options.usePreviousParameters ?? true,
            // Obviously we can't need a bootstrap stack to deploy a bootstrap stack
            envResources: new environment_1.NoBootstrapStackEnvironmentResources(this.resolvedEnvironment, this.sdk, this.ioHelper),
        }, this.ioHelper);
        (0, deployments_1.assertIsSuccessfulDeployStackResult)(ret);
        return ret;
    }
}
exports.BootstrapStack = BootstrapStack;
function bootstrapVersionFromTemplate(template) {
    const versionSources = [
        template.Outputs?.[bootstrap_props_1.BOOTSTRAP_VERSION_OUTPUT]?.Value,
        template.Resources?.[bootstrap_props_1.BOOTSTRAP_VERSION_RESOURCE]?.Properties?.Value,
    ];
    for (const vs of versionSources) {
        if (typeof vs === 'number') {
            return vs;
        }
        if (typeof vs === 'string' && !isNaN(parseInt(vs, 10))) {
            return parseInt(vs, 10);
        }
    }
    return 0;
}
function bootstrapVariantFromTemplate(template) {
    return template.Parameters?.[bootstrap_props_1.BOOTSTRAP_VARIANT_PARAMETER]?.Default ?? bootstrap_props_1.DEFAULT_BOOTSTRAP_VARIANT;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95LWJvb3RzdHJhcC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvYm9vdHN0cmFwL2RlcGxveS1ib290c3RyYXAudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBMEpBLG9FQWVDO0FBRUQsb0VBRUM7QUE3S0QseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QiwwRUFBOEQ7QUFFOUQsNENBQXlFO0FBQ3pFLCtCQUErQjtBQUUvQix1REFLMkI7QUFHM0IsZ0RBQXFFO0FBQ3JFLDhEQUEwRDtBQUMxRCxnREFBc0U7QUFDdEUsMkNBQWtEO0FBQ2xELHNDQUFpQztBQUNqQyxrREFBMEU7QUFFMUU7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILE1BQWEsY0FBYztJQWFOO0lBQ0E7SUFDQTtJQUNBO0lBQ0E7SUFDQTtJQWpCWixNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxXQUF3QixFQUFFLFdBQXdCLEVBQUUsZ0JBQXdCLEVBQUUsUUFBa0I7UUFDekgsZ0JBQWdCLEdBQUcsZ0JBQWdCLElBQUkseUNBQTBCLENBQUM7UUFFbEUsTUFBTSxtQkFBbUIsR0FBRyxNQUFNLFdBQVcsQ0FBQyxrQkFBa0IsQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUM5RSxNQUFNLEdBQUcsR0FBRyxDQUFDLE1BQU0sV0FBVyxDQUFDLGNBQWMsQ0FBQyxtQkFBbUIsRUFBRSxhQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUM7UUFFekYsTUFBTSxrQkFBa0IsR0FBRyxNQUFNLDBCQUFXLENBQUMsTUFBTSxDQUFDLG1CQUFtQixFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztRQUUxRyxPQUFPLElBQUksY0FBYyxDQUFDLFdBQVcsRUFBRSxHQUFHLEVBQUUsbUJBQW1CLEVBQUUsZ0JBQWdCLEVBQUUsa0JBQWtCLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDbkgsQ0FBQztJQUVELFlBQ21CLFdBQXdC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RUFBRSxPQUFPLElBQUksMkNBQXlCLENBQUM7QUFDbEcsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIG9zIGZyb20gJ29zJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBBcnRpZmFjdFR5cGUgfSBmcm9tICdAYXdzLWNkay9jbG91ZC1hc3NlbWJseS1zY2hlbWEnO1xuaW1wb3J0IHR5cGUgeyBFbnZpcm9ubWVudCB9IGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgeyBDbG91ZEFzc2VtYmx5QnVpbGRlciwgRW52aXJvbm1lbnRVdGlscyB9IGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcy1leHRyYSc7XG5pbXBvcnQgdHlwZSB7IEJvb3RzdHJhcEVudmlyb25tZW50T3B0aW9ucyB9IGZyb20gJy4vYm9vdHN0cmFwLXByb3BzJztcbmltcG9ydCB7XG4gIEJPT1RTVFJBUF9WQVJJQU5UX1BBUkFNRVRFUixcbiAgQk9PVFNUUkFQX1ZFUlNJT05fT1VUUFVULFxuICBCT09UU1RSQVBfVkVSU0lPTl9SRVNPVVJDRSxcbiAgREVGQVVMVF9CT09UU1RSQVBfVkFSSUFOVCxcbn0gZnJvbSAnLi9ib290c3RyYXAtcHJvcHMnO1xuaW1wb3J0IHR5cGUgeyBTREssIFNka1Byb3ZpZGVyIH0gZnJvbSAnLi4vYXdzLWF1dGgnO1xuaW1wb3J0IHR5cGUgeyBTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQgfSBmcm9tICcuLi9kZXBsb3ltZW50cyc7XG5pbXBvcnQgeyBhc3NlcnRJc1N1Y2Nlc3NmdWxEZXBsb3lTdGFja1Jlc3VsdCB9IGZyb20gJy4uL2RlcGxveW1lbnRzJztcbmltcG9ydCB7IGRlcGxveVN0YWNrIH0gZnJvbSAnLi4vZGVwbG95bWVudHMvZGVwbG95LXN0YWNrJztcbmltcG9ydCB7IE5vQm9vdHN0cmFwU3RhY2tFbnZpcm9ubWVudFJlc291cmNlcyB9IGZyb20gJy4uL2Vudmlyb25tZW50JztcbmltcG9ydCB7IElPLCB0eXBlIElvSGVscGVyIH0gZnJvbSAnLi4vaW8vcHJpdmF0ZSc7XG5pbXBvcnQgeyBNb2RlIH0gZnJvbSAnLi4vcGx1Z2luJztcbmltcG9ydCB7IERFRkFVTFRfVE9PTEtJVF9TVEFDS19OQU1FLCBUb29sa2l0SW5mbyB9IGZyb20gJy4uL3Rvb2xraXQtaW5mbyc7XG5cbi8qKlxuICogQSBjbGFzcyB0byBob2xkIHN0YXRlIGFyb3VuZCBzdGFjayBib290c3RyYXBwaW5nXG4gKlxuICogVGhpcyBjbGFzcyBleGlzdHMgc28gd2UgY2FuIGJyZWFrIGJvb3RzdHJhcHBpbmcgaW50byAyIHBoYXNlczpcbiAqXG4gKiBgYGB0c1xuICogY29uc3QgY3VycmVudCA9IEJvb3RzdHJhcFN0YWNrLmxvb2t1cCguLi4pO1xuICogLy8gLi4uXG4gKiBjdXJyZW50LnVwZGF0ZShuZXdUZW1wbGF0ZSwgLi4uKTtcbiAqIGBgYFxuICpcbiAqIEFuZCBkbyBzb21ldGhpbmcgaW4gYmV0d2VlbiB0aGUgdHdvIHBoYXNlcyAoc3VjaCBhcyBsb29rIGF0IHRoZVxuICogY3VycmVudCBib290c3RyYXAgc3RhY2sgYW5kIGRvaW5nIHNvbWV0aGluZyBpbnRlbGxpZ2VudCkuXG4gKi9cbmV4cG9ydCBjbGFzcyBCb290c3RyYXBTdGFjayB7XG4gIHB1YmxpYyBzdGF0aWMgYXN5bmMgbG9va3VwKHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlciwgZW52aXJvbm1lbnQ6IEVudmlyb25tZW50LCB0b29sa2l0U3RhY2tOYW1lOiBzdHJpbmcsIGlvSGVscGVyOiBJb0hlbHBlcikge1xuICAgIHRvb2xraXRTdGFja05hbWUgPSB0b29sa2l0U3RhY2tOYW1lID8/IERFRkFVTFRfVE9PTEtJVF9TVEFDS19OQU1FO1xuXG4gICAgY29uc3QgcmVzb2x2ZWRFbnZpcm9ubWVudCA9IGF3YWl0IHNka1Byb3ZpZGVyLnJlc29sdmVFbnZpcm9ubWVudChlbnZpcm9ubWVudCk7XG4gICAgY29uc3Qgc2RrID0gKGF3YWl0IHNka1Byb3ZpZGVyLmZvckVudmlyb25tZW50KHJlc29sdmVkRW52aXJvbm1lbnQsIE1vZGUuRm9yV3JpdGluZykpLnNkaztcblxuICAgIGNvbnN0IGN1cnJlbnRUb29sa2l0SW5mbyA9IGF3YWl0IFRvb2xraXRJbmZvLmxvb2t1cChyZXNvbHZlZEVudmlyb25tZW50LCBzZGssIGlvSGVscGVyLCB0b29sa2l0U3RhY2tOYW1lKTtcblxuICAgIHJldHVybiBuZXcgQm9vdHN0cmFwU3RhY2soc2RrUHJvdmlkZXIsIHNkaywgcmVzb2x2ZWRFbnZpcm9ubWVudCwgdG9vbGtpdFN0YWNrTmFtZSwgY3VycmVudFRvb2xraXRJbmZvLCBpb0hlbHBlcik7XG4gIH1cblxuICBwcm90ZWN0ZWQgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBzZGtQcm92aWRlcjogU2RrUHJvdmlkZXIsXG4gICAgcHJpdmF0ZSByZWFkb25seSBzZGs6IFNESyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJlc29sdmVkRW52aXJvbm1lbnQ6IEVudmlyb25tZW50LFxuICAgIHByaXZhdGUgcmVhZG9ubHkgdG9vbGtpdFN0YWNrTmFtZTogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3VycmVudFRvb2xraXRJbmZvOiBUb29sa2l0SW5mbyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGlvSGVscGVyOiBJb0hlbHBlcixcbiAgKSB7XG4gIH1cblxuICBwdWJsaWMgZ2V0IHBhcmFtZXRlcnMoKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gICAgcmV0dXJuIHRoaXMuY3VycmVudFRvb2xraXRJbmZvLmZvdW5kID8gdGhpcy5jdXJyZW50VG9vbGtpdEluZm8uYm9vdHN0cmFwU3RhY2sucGFyYW1ldGVycyA6IHt9O1xuICB9XG5cbiAgcHVibGljIGdldCB0ZXJtaW5hdGlvblByb3RlY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuY3VycmVudFRvb2xraXRJbmZvLmZvdW5kID8gdGhpcy5jdXJyZW50VG9vbGtpdEluZm8uYm9vdHN0cmFwU3RhY2sudGVybWluYXRpb25Qcm90ZWN0aW9uIDogdW5kZWZpbmVkO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHBhcnRpdGlvbigpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHJldHVybiAoYXdhaXQgdGhpcy5zZGsuY3VycmVudEFjY291bnQoKSkucGFydGl0aW9uO1xuICB9XG5cbiAgLyoqXG4gICAqIFBlcmZvcm0gdGhlIGFjdHVhbCBkZXBsb3ltZW50IG9mIGEgYm9vdHN0cmFwIHN0YWNrLCBnaXZlbiBhIHRlbXBsYXRlIGFuZCBzb21lIHBhcmFtZXRlcnNcbiAgICovXG4gIHB1YmxpYyBhc3luYyB1cGRhdGUoXG4gICAgdGVtcGxhdGU6IGFueSxcbiAgICBwYXJhbWV0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+LFxuICAgIG9wdGlvbnM6IE9taXQ8Qm9vdHN0cmFwRW52aXJvbm1lbnRPcHRpb25zLCAncGFyYW1ldGVycyc+LFxuICApOiBQcm9taXNlPFN1Y2Nlc3NmdWxEZXBsb3lTdGFja1Jlc3VsdD4ge1xuICAgIGlmICh0aGlzLmN1cnJlbnRUb29sa2l0SW5mby5mb3VuZCAmJiAhb3B0aW9ucy5mb3JjZURlcGxveW1lbnQpIHtcbiAgICAgIC8vIFNhZmV0eSBjaGVja3NcbiAgICAgIGNvbnN0IGFib3J0UmVzcG9uc2UgPSB7XG4gICAgICAgIHR5cGU6ICdkaWQtZGVwbG95LXN0YWNrJyxcbiAgICAgICAgbm9PcDogdHJ1ZSxcbiAgICAgICAgb3V0cHV0czoge30sXG4gICAgICAgIHN0YWNrQXJuOiB0aGlzLmN1cnJlbnRUb29sa2l0SW5mby5ib290c3RyYXBTdGFjay5zdGFja0lkLFxuICAgICAgfSBzYXRpc2ZpZXMgU3VjY2Vzc2Z1bERlcGxveVN0YWNrUmVzdWx0O1xuXG4gICAgICAvLyBWYWxpZGF0ZSB0aGF0IHRoZSBib290c3RyYXAgc3RhY2sgd2UncmUgdHJ5aW5nIHRvIHJlcGxhY2UgaXMgZnJvbSB0aGUgc2FtZSB2YXJpYW50IGFzIHRoZSBvbmUgd2UncmUgdHJ5aW5nIHRvIGRlcGxveVxuICAgICAgY29uc3QgY3VycmVudFZhcmlhbnQgPSB0aGlzLmN1cnJlbnRUb29sa2l0SW5mby52YXJpYW50O1xuICAgICAgY29uc3QgbmV3VmFyaWFudCA9IGJvb3RzdHJhcFZhcmlhbnRGcm9tVGVtcGxhdGUodGVtcGxhdGUpO1xuICAgICAgaWYgKGN1cnJlbnRWYXJpYW50ICE9PSBuZXdWYXJpYW50KSB7XG4gICAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9XQVJOLm1zZyhcbiAgICAgICAgICBgQm9vdHN0cmFwIHN0YWNrIGFscmVhZHkgZXhpc3RzLCBjb250YWluaW5nICcke2N1cnJlbnRWYXJpYW50fScuIE5vdCBvdmVyd3JpdGluZyBpdCB3aXRoIGEgdGVtcGxhdGUgY29udGFpbmluZyAnJHtuZXdWYXJpYW50fScgKHVzZSAtLWZvcmNlIGlmIHlvdSBpbnRlbmQgdG8gb3ZlcndyaXRlKWAsXG4gICAgICAgICkpO1xuICAgICAgICByZXR1cm4gYWJvcnRSZXNwb25zZTtcbiAgICAgIH1cblxuICAgICAgLy8gVmFsaWRhdGUgdGhhdCB3ZSdyZSBub3QgZG93bmdyYWRpbmcgdGhlIGJvb3RzdHJhcCBzdGFja1xuICAgICAgY29uc3QgbmV3VmVyc2lvbiA9IGJvb3RzdHJhcFZlcnNpb25Gcm9tVGVtcGxhdGUodGVtcGxhdGUpO1xuICAgICAgY29uc3QgY3VycmVudFZlcnNpb24gPSB0aGlzLmN1cnJlbnRUb29sa2l0SW5mby52ZXJzaW9uO1xuICAgICAgaWYgKG5ld1ZlcnNpb24gPCBjdXJyZW50VmVyc2lvbikge1xuICAgICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfV0FSTi5tc2coXG4gICAgICAgICAgYEJvb3RzdHJhcCBzdGFjayBhbHJlYWR5IGF0IHZlcnNpb24gJHtjdXJyZW50VmVyc2lvbn0uIE5vdCBkb3duZ3JhZGluZyBpdCB0byB2ZXJzaW9uICR7bmV3VmVyc2lvbn0gKHVzZSAtLWZvcmNlIGlmIHlvdSBpbnRlbmQgdG8gZG93bmdyYWRlKWAsXG4gICAgICAgICkpO1xuICAgICAgICBpZiAobmV3VmVyc2lvbiA9PT0gMCkge1xuICAgICAgICAgIC8vIEEgZG93bmdyYWRlIHdpdGggMCBhcyB0YXJnZXQgdmVyc2lvbiBtZWFucyB3ZSBwcm9iYWJseSBoYXZlIGEgbmV3LXN0eWxlIGJvb3RzdHJhcCBpbiB0aGUgYWNjb3VudCxcbiAgICAgICAgICAvLyBhbmQgYW4gb2xkLXN0eWxlIGJvb3RzdHJhcCBhcyBjdXJyZW50IHRhcmdldCwgd2hpY2ggbWVhbnMgdGhlIHVzZXIgcHJvYmFibHkgZm9yZ290IHRvIHB1dCB0aGlzIGZsYWcgaW4uXG4gICAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX1dBUk4ubXNnKFxuICAgICAgICAgICAgXCIoRGlkIHlvdSBzZXQgdGhlICdAYXdzLWNkay9jb3JlOm5ld1N0eWxlU3RhY2tTeW50aGVzaXMnIGZlYXR1cmUgZmxhZyBpbiBjZGsuanNvbj8pXCIsXG4gICAgICAgICAgKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGFib3J0UmVzcG9uc2U7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgb3V0ZGlyID0gYXdhaXQgZnMubWtkdGVtcChwYXRoLmpvaW4ob3MudG1wZGlyKCksICdjZGstYm9vdHN0cmFwJykpO1xuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgQ2xvdWRBc3NlbWJseUJ1aWxkZXIob3V0ZGlyKTtcbiAgICBjb25zdCB0ZW1wbGF0ZUZpbGUgPSBgJHt0aGlzLnRvb2xraXRTdGFja05hbWV9LnRlbXBsYXRlLmpzb25gO1xuICAgIGF3YWl0IGZzLndyaXRlSnNvbihwYXRoLmpvaW4oYnVpbGRlci5vdXRkaXIsIHRlbXBsYXRlRmlsZSksIHRlbXBsYXRlLCB7XG4gICAgICBzcGFjZXM6IDIsXG4gICAgfSk7XG5cbiAgICBidWlsZGVyLmFkZEFydGlmYWN0KHRoaXMudG9vbGtpdFN0YWNrTmFtZSwge1xuICAgICAgdHlwZTogQXJ0aWZhY3RUeXBlLkFXU19DTE9VREZPUk1BVElPTl9TVEFDSyxcbiAgICAgIGVudmlyb25tZW50OiBFbnZpcm9ubWVudFV0aWxzLmZvcm1hdCh0aGlzLnJlc29sdmVkRW52aXJvbm1lbnQuYWNjb3VudCwgdGhpcy5yZXNvbHZlZEVudmlyb25tZW50LnJlZ2lvbiksXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIHRlbXBsYXRlRmlsZSxcbiAgICAgICAgdGVybWluYXRpb25Qcm90ZWN0aW9uOiBvcHRpb25zLnRlcm1pbmF0aW9uUHJvdGVjdGlvbiA/PyBmYWxzZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBhc3NlbWJseSA9IGJ1aWxkZXIuYnVpbGRBc3NlbWJseSgpO1xuXG4gICAgY29uc3QgcmV0ID0gYXdhaXQgZGVwbG95U3RhY2soe1xuICAgICAgc3RhY2s6IGFzc2VtYmx5LmdldFN0YWNrQnlOYW1lKHRoaXMudG9vbGtpdFN0YWNrTmFtZSksXG4gICAgICByZXNvbHZlZEVudmlyb25tZW50OiB0aGlzLnJlc29sdmVkRW52aXJvbm1lbnQsXG4gICAgICBzZGs6IHRoaXMuc2RrLFxuICAgICAgc2RrUHJvdmlkZXI6IHRoaXMuc2RrUHJvdmlkZXIsXG4gICAgICBmb3JjZURlcGxveW1lbnQ6IG9wdGlvbnMuZm9yY2VEZXBsb3ltZW50LFxuICAgICAgcm9sZUFybjogb3B0aW9ucy5yb2xlQXJuLFxuICAgICAgdGFnczogb3B0aW9ucy50YWdzLFxuICAgICAgZGVwbG95bWVudE1ldGhvZDogeyBtZXRob2Q6ICdjaGFuZ2Utc2V0JywgZXhlY3V0ZTogb3B0aW9ucy5leGVjdXRlIH0sXG4gICAgICBwYXJhbWV0ZXJzLFxuICAgICAgdXNlUHJldmlvdXNQYXJhbWV0ZXJzOiBvcHRpb25zLnVzZVByZXZpb3VzUGFyYW1ldGVycyA/PyB0cnVlLFxuICAgICAgLy8gT2J2aW91c2x5IHdlIGNhbid0IG5lZWQgYSBib290c3RyYXAgc3RhY2sgdG8gZGVwbG95IGEgYm9vdHN0cmFwIHN0YWNrXG4gICAgICBlbnZSZXNvdXJjZXM6IG5ldyBOb0Jvb3RzdHJhcFN0YWNrRW52aXJvbm1lbnRSZXNvdXJjZXModGhpcy5yZXNvbHZlZEVudmlyb25tZW50LCB0aGlzLnNkaywgdGhpcy5pb0hlbHBlciksXG4gICAgfSwgdGhpcy5pb0hlbHBlcik7XG5cbiAgICBhc3NlcnRJc1N1Y2Nlc3NmdWxEZXBsb3lTdGFja1Jlc3VsdChyZXQpO1xuXG4gICAgcmV0dXJuIHJldDtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYm9vdHN0cmFwVmVyc2lvbkZyb21UZW1wbGF0ZSh0ZW1wbGF0ZTogYW55KTogbnVtYmVyIHtcbiAgY29uc3QgdmVyc2lvblNvdXJjZXMgPSBbXG4gICAgdGVtcGxhdGUuT3V0cHV0cz8uW0JPT1RTVFJBUF9WRVJTSU9OX09VVFBVVF0/LlZhbHVlLFxuICAgIHRlbXBsYXRlLlJlc291cmNlcz8uW0JPT1RTVFJBUF9WRVJTSU9OX1JFU09VUkNFXT8uUHJvcGVydGllcz8uVmFsdWUsXG4gIF07XG5cbiAgZm9yIChjb25zdCB2cyBvZiB2ZXJzaW9uU291cmNlcykge1xuICAgIGlmICh0eXBlb2YgdnMgPT09ICdudW1iZXInKSB7XG4gICAgICByZXR1cm4gdnM7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgdnMgPT09ICdzdHJpbmcnICYmICFpc05hTihwYXJzZUludCh2cywgMTApKSkge1xuICAgICAgcmV0dXJuIHBhcnNlSW50KHZzLCAxMCk7XG4gICAgfVxuICB9XG4gIHJldHVybiAwO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYm9vdHN0cmFwVmFyaWFudEZyb21UZW1wbGF0ZSh0ZW1wbGF0ZTogYW55KTogc3RyaW5nIHtcbiAgcmV0dXJuIHRlbXBsYXRlLlBhcmFtZXRlcnM/LltCT09UU1RSQVBfVkFSSUFOVF9QQVJBTUVURVJdPy5EZWZhdWx0ID8/IERFRkFVTFRfQk9PVFNUUkFQX1ZBUklBTlQ7XG59XG4iXX0=