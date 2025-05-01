"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoBootstrapStackEnvironmentResources = exports.EnvironmentResources = exports.EnvironmentResourcesRegistry = void 0;
const util_1 = require("../../util");
const private_1 = require("../io/private");
const notices_1 = require("../notices");
const toolkit_error_1 = require("../toolkit-error");
const toolkit_info_1 = require("../toolkit-info");
/**
 * Registry class for `EnvironmentResources`.
 *
 * The state management of this class is a bit non-standard. We want to cache
 * data related to toolkit stacks and SSM parameters, but we are not in charge
 * of ensuring caching of SDKs. Since `EnvironmentResources` needs an SDK to
 * function, we treat it as an ephemeral class, and store the actual cached data
 * in `EnvironmentResourcesRegistry`.
 */
class EnvironmentResourcesRegistry {
    toolkitStackName;
    cache = new Map();
    constructor(toolkitStackName) {
        this.toolkitStackName = toolkitStackName;
    }
    for(resolvedEnvironment, sdk, ioHelper) {
        const key = `${resolvedEnvironment.account}:${resolvedEnvironment.region}`;
        let envCache = this.cache.get(key);
        if (!envCache) {
            envCache = emptyCache();
            this.cache.set(key, envCache);
        }
        return new EnvironmentResources(resolvedEnvironment, sdk, ioHelper, envCache, this.toolkitStackName);
    }
}
exports.EnvironmentResourcesRegistry = EnvironmentResourcesRegistry;
/**
 * Interface with the account and region we're deploying into
 *
 * Manages lookups for bootstrapped resources, falling back to the legacy "CDK Toolkit"
 * original bootstrap stack if necessary.
 *
 * The state management of this class is a bit non-standard. We want to cache
 * data related to toolkit stacks and SSM parameters, but we are not in charge
 * of ensuring caching of SDKs. Since `EnvironmentResources` needs an SDK to
 * function, we treat it as an ephemeral class, and store the actual cached data
 * in `EnvironmentResourcesRegistry`.
 */
class EnvironmentResources {
    environment;
    sdk;
    ioHelper;
    cache;
    toolkitStackName;
    constructor(environment, sdk, ioHelper, cache, toolkitStackName) {
        this.environment = environment;
        this.sdk = sdk;
        this.ioHelper = ioHelper;
        this.cache = cache;
        this.toolkitStackName = toolkitStackName;
    }
    /**
     * Look up the toolkit for a given environment, using a given SDK
     */
    async lookupToolkit() {
        if (!this.cache.toolkitInfo) {
            this.cache.toolkitInfo = await toolkit_info_1.ToolkitInfo.lookup(this.environment, this.sdk, this.ioHelper, this.toolkitStackName);
        }
        return this.cache.toolkitInfo;
    }
    /**
     * Validate that the bootstrap stack version matches or exceeds the expected version
     *
     * Use the SSM parameter name to read the version number if given, otherwise use the version
     * discovered on the bootstrap stack.
     *
     * Pass in the SSM parameter name so we can cache the lookups an don't need to do the same
     * lookup again and again for every artifact.
     */
    async validateVersion(expectedVersion, ssmParameterName) {
        if (expectedVersion === undefined) {
            // No requirement
            return;
        }
        const defExpectedVersion = expectedVersion;
        if (ssmParameterName !== undefined) {
            try {
                doValidate(await this.versionFromSsmParameter(ssmParameterName), this.environment);
                return;
            }
            catch (e) {
                if (e.name !== 'AccessDeniedException') {
                    throw e;
                }
                // This is a fallback! The bootstrap template that goes along with this change introduces
                // a new 'ssm:GetParameter' permission, but when run using the previous bootstrap template we
                // won't have the permissions yet to read the version, so we won't be able to show the
                // message telling the user they need to update! When we see an AccessDeniedException, fall
                // back to the version we read from Stack Outputs; but ONLY if the version we discovered via
                // outputs is legitimately an old version. If it's newer than that, something else must be broken,
                // so let it fail as it would if we didn't have this fallback.
                const bootstrapStack = await this.lookupToolkit();
                if (bootstrapStack.found && bootstrapStack.version < BOOTSTRAP_TEMPLATE_VERSION_INTRODUCING_GETPARAMETER) {
                    await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg(`Could not read SSM parameter ${ssmParameterName}: ${(0, util_1.formatErrorMessage)(e)}, falling back to version from ${bootstrapStack}`));
                    doValidate(bootstrapStack.version, this.environment);
                    return;
                }
                throw new toolkit_error_1.ToolkitError(`This CDK deployment requires bootstrap stack version '${expectedVersion}', but during the confirmation via SSM parameter ${ssmParameterName} the following error occurred: ${e}`);
            }
        }
        // No SSM parameter
        const bootstrapStack = await this.lookupToolkit();
        doValidate(bootstrapStack.version, this.environment);
        function doValidate(version, environment) {
            const notices = notices_1.Notices.get();
            if (notices) {
                // if `Notices` hasn't been initialized there is probably a good
                // reason for it. handle gracefully.
                notices.addBootstrappedEnvironment({ bootstrapStackVersion: version, environment });
            }
            if (defExpectedVersion > version) {
                throw new toolkit_error_1.ToolkitError(`This CDK deployment requires bootstrap stack version '${expectedVersion}', found '${version}'. Please run 'cdk bootstrap'.`);
            }
        }
    }
    /**
     * Read a version from an SSM parameter, cached
     */
    async versionFromSsmParameter(parameterName) {
        const existing = this.cache.ssmParameters.get(parameterName);
        if (existing !== undefined) {
            return existing;
        }
        const ssm = this.sdk.ssm();
        try {
            const result = await ssm.getParameter({ Name: parameterName });
            const asNumber = parseInt(`${result.Parameter?.Value}`, 10);
            if (isNaN(asNumber)) {
                throw new toolkit_error_1.ToolkitError(`SSM parameter ${parameterName} not a number: ${result.Parameter?.Value}`);
            }
            this.cache.ssmParameters.set(parameterName, asNumber);
            return asNumber;
        }
        catch (e) {
            if (e.name === 'ParameterNotFound') {
                throw new toolkit_error_1.ToolkitError(`SSM parameter ${parameterName} not found. Has the environment been bootstrapped? Please run \'cdk bootstrap\' (see https://docs.aws.amazon.com/cdk/latest/guide/bootstrapping.html)`);
            }
            throw e;
        }
    }
    async prepareEcrRepository(repositoryName) {
        if (!this.sdk) {
            throw new toolkit_error_1.ToolkitError('ToolkitInfo needs to have been initialized with an sdk to call prepareEcrRepository');
        }
        const ecr = this.sdk.ecr();
        // check if repo already exists
        try {
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${repositoryName}: checking if ECR repository already exists`));
            const describeResponse = await ecr.describeRepositories({
                repositoryNames: [repositoryName],
            });
            const existingRepositoryUri = describeResponse.repositories[0]?.repositoryUri;
            if (existingRepositoryUri) {
                return { repositoryUri: existingRepositoryUri };
            }
        }
        catch (e) {
            if (e.name !== 'RepositoryNotFoundException') {
                throw e;
            }
        }
        // create the repo (tag it so it will be easier to garbage collect in the future)
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${repositoryName}: creating ECR repository`));
        const assetTag = { Key: 'awscdk:asset', Value: 'true' };
        const response = await ecr.createRepository({
            repositoryName,
            tags: [assetTag],
        });
        const repositoryUri = response.repository?.repositoryUri;
        if (!repositoryUri) {
            throw new toolkit_error_1.ToolkitError(`CreateRepository did not return a repository URI for ${repositoryUri}`);
        }
        // configure image scanning on push (helps in identifying software vulnerabilities, no additional charge)
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${repositoryName}: enable image scanning`));
        await ecr.putImageScanningConfiguration({
            repositoryName,
            imageScanningConfiguration: { scanOnPush: true },
        });
        return { repositoryUri };
    }
}
exports.EnvironmentResources = EnvironmentResources;
class NoBootstrapStackEnvironmentResources extends EnvironmentResources {
    constructor(environment, sdk, ioHelper) {
        super(environment, sdk, ioHelper, emptyCache());
    }
    /**
     * Look up the toolkit for a given environment, using a given SDK
     */
    async lookupToolkit() {
        throw new toolkit_error_1.ToolkitError('Trying to perform an operation that requires a bootstrap stack; you should not see this error, this is a bug in the CDK CLI.');
    }
}
exports.NoBootstrapStackEnvironmentResources = NoBootstrapStackEnvironmentResources;
function emptyCache() {
    return {
        ssmParameters: new Map(),
        toolkitInfo: undefined,
    };
}
/**
 * The bootstrap template version that introduced ssm:GetParameter
 */
const BOOTSTRAP_TEMPLATE_VERSION_INTRODUCING_GETPARAMETER = 5;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW52aXJvbm1lbnQtcmVzb3VyY2VzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9lbnZpcm9ubWVudC9lbnZpcm9ubWVudC1yZXNvdXJjZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EscUNBQWdEO0FBRWhELDJDQUFrRDtBQUNsRCx3Q0FBcUM7QUFDckMsb0RBQWdEO0FBQ2hELGtEQUFzRTtBQUV0RTs7Ozs7Ozs7R0FRRztBQUNILE1BQWEsNEJBQTRCO0lBR1Y7SUFGWixLQUFLLEdBQUcsSUFBSSxHQUFHLEVBQTRCLENBQUM7SUFFN0QsWUFBNkIsZ0JBQXlCO1FBQXpCLHFCQUFnQixHQUFoQixnQkFBZ0IsQ0FBUztJQUN0RCxDQUFDO0lBRU0sR0FBRyxDQUFDLG1CQUFnQyxFQUFFLEdBQVEsRUFBRSxRQUFrQjtRQUN2RSxNQUFNLEdBQUcsR0FBRyxHQUFHLG1CQUFtQixDQUFDLE9BQU8sSUFBSSxtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUMzRSxJQUFJLFFBQVEsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNuQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDZCxRQUFRLEdBQUcsVUFBVSxFQUFFLENBQUM7WUFDeEIsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQ2hDLENBQUM7UUFDRCxPQUFPLElBQUksb0JBQW9CLENBQUMsbUJBQW1CLEVBQUUsR0FBRyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUM7SUFDdkcsQ0FBQztDQUNGO0FBZkQsb0VBZUM7QUFFRDs7Ozs7Ozs7Ozs7R0FXRztBQUNILE1BQWEsb0JBQW9CO0lBRWI7SUFDQztJQUNBO0lBQ0E7SUFDQTtJQUxuQixZQUNrQixXQUF3QixFQUN2QixHQUFRLEVBQ1IsUUFBa0Is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QixXQUFXLEVBQUUsU0FBUztLQUN2QixDQUFDO0FBQ0osQ0FBQztBQUVEOztHQUVHO0FBQ0gsTUFBTSxtREFBbUQsR0FBRyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEVudmlyb25tZW50IH0gZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCB7IGZvcm1hdEVycm9yTWVzc2FnZSB9IGZyb20gJy4uLy4uL3V0aWwnO1xuaW1wb3J0IHR5cGUgeyBTREsgfSBmcm9tICcuLi9hd3MtYXV0aCc7XG5pbXBvcnQgeyBJTywgdHlwZSBJb0hlbHBlciB9IGZyb20gJy4uL2lvL3ByaXZhdGUnO1xuaW1wb3J0IHsgTm90aWNlcyB9IGZyb20gJy4uL25vdGljZXMnO1xuaW1wb3J0IHsgVG9vbGtpdEVycm9yIH0gZnJvbSAnLi4vdG9vbGtpdC1lcnJvcic7XG5pbXBvcnQgeyB0eXBlIEVjclJlcG9zaXRvcnlJbmZvLCBUb29sa2l0SW5mbyB9IGZyb20gJy4uL3Rvb2xraXQtaW5mbyc7XG5cbi8qKlxuICogUmVnaXN0cnkgY2xhc3MgZm9yIGBFbnZpcm9ubWVudFJlc291cmNlc2AuXG4gKlxuICogVGhlIHN0YXRlIG1hbmFnZW1lbnQgb2YgdGhpcyBjbGFzcyBpcyBhIGJpdCBub24tc3RhbmRhcmQuIFdlIHdhbnQgdG8gY2FjaGVcbiAqIGRhdGEgcmVsYXRlZCB0byB0b29sa2l0IHN0YWNrcyBhbmQgU1NNIHBhcmFtZXRlcnMsIGJ1dCB3ZSBhcmUgbm90IGluIGNoYXJnZVxuICogb2YgZW5zdXJpbmcgY2FjaGluZyBvZiBTREtzLiBTaW5jZSBgRW52aXJvbm1lbnRSZXNvdXJjZXNgIG5lZWRzIGFuIFNESyB0b1xuICogZnVuY3Rpb24sIHdlIHRyZWF0IGl0IGFzIGFuIGVwaGVtZXJhbCBjbGFzcywgYW5kIHN0b3JlIHRoZSBhY3R1YWwgY2FjaGVkIGRhdGFcbiAqIGluIGBFbnZpcm9ubWVudFJlc291cmNlc1JlZ2lzdHJ5YC5cbiAqL1xuZXhwb3J0IGNsYXNzIEVudmlyb25tZW50UmVzb3VyY2VzUmVnaXN0cnkge1xuICBwcml2YXRlIHJlYWRvbmx5IGNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIEVudmlyb25tZW50Q2FjaGU+KCk7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSB0b29sa2l0U3RhY2tOYW1lPzogc3RyaW5nKSB7XG4gIH1cblxuICBwdWJsaWMgZm9yKHJlc29sdmVkRW52aXJvbm1lbnQ6IEVudmlyb25tZW50LCBzZGs6IFNESywgaW9IZWxwZXI6IElvSGVscGVyKSB7XG4gICAgY29uc3Qga2V5ID0gYCR7cmVzb2x2ZWRFbnZpcm9ubWVudC5hY2NvdW50fToke3Jlc29sdmVkRW52aXJvbm1lbnQucmVnaW9ufWA7XG4gICAgbGV0IGVudkNhY2hlID0gdGhpcy5jYWNoZS5nZXQoa2V5KTtcbiAgICBpZiAoIWVudkNhY2hlKSB7XG4gICAgICBlbnZDYWNoZSA9IGVtcHR5Q2FjaGUoKTtcbiAgICAgIHRoaXMuY2FjaGUuc2V0KGtleSwgZW52Q2FjaGUpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IEVudmlyb25tZW50UmVzb3VyY2VzKHJlc29sdmVkRW52aXJvbm1lbnQsIHNkaywgaW9IZWxwZXIsIGVudkNhY2hlLCB0aGlzLnRvb2xraXRTdGFja05hbWUpO1xuICB9XG59XG5cbi8qKlxuICogSW50ZXJmYWNlIHdpdGggdGhlIGFjY291bnQgYW5kIHJlZ2lvbiB3ZSdyZSBkZXBsb3lpbmcgaW50b1xuICpcbiAqIE1hbmFnZXMgbG9va3VwcyBmb3IgYm9vdHN0cmFwcGVkIHJlc291cmNlcywgZmFsbGluZyBiYWNrIHRvIHRoZSBsZWdhY3kgXCJDREsgVG9vbGtpdFwiXG4gKiBvcmlnaW5hbCBib290c3RyYXAgc3RhY2sgaWYgbmVjZXNzYXJ5LlxuICpcbiAqIFRoZSBzdGF0ZSBtYW5hZ2VtZW50IG9mIHRoaXMgY2xhc3MgaXMgYSBiaXQgbm9uLXN0YW5kYXJkLiBXZSB3YW50IHRvIGNhY2hlXG4gKiBkYXRhIHJlbGF0ZWQgdG8gdG9vbGtpdCBzdGFja3MgYW5kIFNTTSBwYXJhbWV0ZXJzLCBidXQgd2UgYXJlIG5vdCBpbiBjaGFyZ2VcbiAqIG9mIGVuc3VyaW5nIGNhY2hpbmcgb2YgU0RLcy4gU2luY2UgYEVudmlyb25tZW50UmVzb3VyY2VzYCBuZWVkcyBhbiBTREsgdG9cbiAqIGZ1bmN0aW9uLCB3ZSB0cmVhdCBpdCBhcyBhbiBlcGhlbWVyYWwgY2xhc3MsIGFuZCBzdG9yZSB0aGUgYWN0dWFsIGNhY2hlZCBkYXRhXG4gKiBpbiBgRW52aXJvbm1lbnRSZXNvdXJjZXNSZWdpc3RyeWAuXG4gKi9cbmV4cG9ydCBjbGFzcyBFbnZpcm9ubWVudFJlc291cmNlcyB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyByZWFkb25seSBlbnZpcm9ubWVudDogRW52aXJvbm1lbnQsXG4gICAgcHJpdmF0ZSByZWFkb25seSBzZGs6IFNESyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGlvSGVscGVyOiBJb0hlbHBlcixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNhY2hlOiBFbnZpcm9ubWVudENhY2hlLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgdG9vbGtpdFN0YWNrTmFtZT86IHN0cmluZyxcbiAgKSB7XG4gIH1cblxuICAvKipcbiAgICogTG9vayB1cCB0aGUgdG9vbGtpdCBmb3IgYSBnaXZlbiBlbnZpcm9ubWVudCwgdXNpbmcgYSBnaXZlbiBTREtcbiAgICovXG4gIHB1YmxpYyBhc3luYyBsb29rdXBUb29sa2l0KCkge1xuICAgIGlmICghdGhpcy5jYWNoZS50b29sa2l0SW5mbykge1xuICAgICAgdGhpcy5jYWNoZS50b29sa2l0SW5mbyA9IGF3YWl0IFRvb2xraXRJbmZvLmxvb2t1cCh0aGlzLmVudmlyb25tZW50LCB0aGlzLnNkaywgdGhpcy5pb0hlbHBlciwgdGhpcy50b29sa2l0U3RhY2tOYW1lKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuY2FjaGUudG9vbGtpdEluZm87XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGUgdGhhdCB0aGUgYm9vdHN0cmFwIHN0YWNrIHZlcnNpb24gbWF0Y2hlcyBvciBleGNlZWRzIHRoZSBleHBlY3RlZCB2ZXJzaW9uXG4gICAqXG4gICAqIFVzZSB0aGUgU1NNIHBhcmFtZXRlciBuYW1lIHRvIHJlYWQgdGhlIHZlcnNpb24gbnVtYmVyIGlmIGdpdmVuLCBvdGhlcndpc2UgdXNlIHRoZSB2ZXJzaW9uXG4gICAqIGRpc2NvdmVyZWQgb24gdGhlIGJvb3RzdHJhcCBzdGFjay5cbiAgICpcbiAgICogUGFzcyBpbiB0aGUgU1NNIHBhcmFtZXRlciBuYW1lIHNvIHdlIGNhbiBjYWNoZSB0aGUgbG9va3VwcyBhbiBkb24ndCBuZWVkIHRvIGRvIHRoZSBzYW1lXG4gICAqIGxvb2t1cCBhZ2FpbiBhbmQgYWdhaW4gZm9yIGV2ZXJ5IGFydGlmYWN0LlxuICAgKi9cbiAgcHVibGljIGFzeW5jIHZhbGlkYXRlVmVyc2lvbihleHBlY3RlZFZlcnNpb246IG51bWJlciB8IHVuZGVmaW5lZCwgc3NtUGFyYW1ldGVyTmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkKSB7XG4gICAgaWYgKGV4cGVjdGVkVmVyc2lvbiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBObyByZXF1aXJlbWVudFxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBkZWZFeHBlY3RlZFZlcnNpb24gPSBleHBlY3RlZFZlcnNpb247XG5cbiAgICBpZiAoc3NtUGFyYW1ldGVyTmFtZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0cnkge1xuICAgICAgICBkb1ZhbGlkYXRlKGF3YWl0IHRoaXMudmVyc2lvbkZyb21Tc21QYXJhbWV0ZXIoc3NtUGFyYW1ldGVyTmFtZSksIHRoaXMuZW52aXJvbm1lbnQpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgaWYgKGUubmFtZSAhPT0gJ0FjY2Vzc0RlbmllZEV4Y2VwdGlvbicpIHtcbiAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVGhpcyBpcyBhIGZhbGxiYWNrISBUaGUgYm9vdHN0cmFwIHRlbXBsYXRlIHRoYXQgZ29lcyBhbG9uZyB3aXRoIHRoaXMgY2hhbmdlIGludHJvZHVjZXNcbiAgICAgICAgLy8gYSBuZXcgJ3NzbTpHZXRQYXJhbWV0ZXInIHBlcm1pc3Npb24sIGJ1dCB3aGVuIHJ1biB1c2luZyB0aGUgcHJldmlvdXMgYm9vdHN0cmFwIHRlbXBsYXRlIHdlXG4gICAgICAgIC8vIHdvbid0IGhhdmUgdGhlIHBlcm1pc3Npb25zIHlldCB0byByZWFkIHRoZSB2ZXJzaW9uLCBzbyB3ZSB3b24ndCBiZSBhYmxlIHRvIHNob3cgdGhlXG4gICAgICAgIC8vIG1lc3NhZ2UgdGVsbGluZyB0aGUgdXNlciB0aGV5IG5lZWQgdG8gdXBkYXRlISBXaGVuIHdlIHNlZSBhbiBBY2Nlc3NEZW5pZWRFeGNlcHRpb24sIGZhbGxcbiAgICAgICAgLy8gYmFjayB0byB0aGUgdmVyc2lvbiB3ZSByZWFkIGZyb20gU3RhY2sgT3V0cHV0czsgYnV0IE9OTFkgaWYgdGhlIHZlcnNpb24gd2UgZGlzY292ZXJlZCB2aWFcbiAgICAgICAgLy8gb3V0cHV0cyBpcyBsZWdpdGltYXRlbHkgYW4gb2xkIHZlcnNpb24uIElmIGl0J3MgbmV3ZXIgdGhhbiB0aGF0LCBzb21ldGhpbmcgZWxzZSBtdXN0IGJlIGJyb2tlbixcbiAgICAgICAgLy8gc28gbGV0IGl0IGZhaWwgYXMgaXQgd291bGQgaWYgd2UgZGlkbid0IGhhdmUgdGhpcyBmYWxsYmFjay5cbiAgICAgICAgY29uc3QgYm9vdHN0cmFwU3RhY2sgPSBhd2FpdCB0aGlzLmxvb2t1cFRvb2xraXQoKTtcbiAgICAgICAgaWYgKGJvb3RzdHJhcFN0YWNrLmZvdW5kICYmIGJvb3RzdHJhcFN0YWNrLnZlcnNpb24gPCBCT09UU1RSQVBfVEVNUExBVEVfVkVSU0lPTl9JTlRST0RVQ0lOR19HRVRQQVJBTUVURVIpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfV0FSTi5tc2coXG4gICAgICAgICAgICBgQ291bGQgbm90IHJlYWQgU1NNIHBhcmFtZXRlciAke3NzbVBhcmFtZXRlck5hbWV9OiAke2Zvcm1hdEVycm9yTWVzc2FnZShlKX0sIGZhbGxpbmcgYmFjayB0byB2ZXJzaW9uIGZyb20gJHtib290c3RyYXBTdGFja31gLFxuICAgICAgICAgICkpO1xuICAgICAgICAgIGRvVmFsaWRhdGUoYm9vdHN0cmFwU3RhY2sudmVyc2lvbiwgdGhpcy5lbnZpcm9ubWVudCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihcbiAgICAgICAgICBgVGhpcyBDREsgZGVwbG95bWVudCByZXF1aXJlcyBib290c3RyYXAgc3RhY2sgdmVyc2lvbiAnJHtleHBlY3RlZFZlcnNpb259JywgYnV0IGR1cmluZyB0aGUgY29uZmlybWF0aW9uIHZpYSBTU00gcGFyYW1ldGVyICR7c3NtUGFyYW1ldGVyTmFtZX0gdGhlIGZvbGxvd2luZyBlcnJvciBvY2N1cnJlZDogJHtlfWAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gTm8gU1NNIHBhcmFtZXRlclxuICAgIGNvbnN0IGJvb3RzdHJhcFN0YWNrID0gYXdhaXQgdGhpcy5sb29rdXBUb29sa2l0KCk7XG4gICAgZG9WYWxpZGF0ZShib290c3RyYXBTdGFjay52ZXJzaW9uLCB0aGlzLmVudmlyb25tZW50KTtcblxuICAgIGZ1bmN0aW9uIGRvVmFsaWRhdGUodmVyc2lvbjogbnVtYmVyLCBlbnZpcm9ubWVudDogRW52aXJvbm1lbnQpIHtcbiAgICAgIGNvbnN0IG5vdGljZXMgPSBOb3RpY2VzLmdldCgpO1xuICAgICAgaWYgKG5vdGljZXMpIHtcbiAgICAgICAgLy8gaWYgYE5vdGljZXNgIGhhc24ndCBiZWVuIGluaXRpYWxpemVkIHRoZXJlIGlzIHByb2JhYmx5IGEgZ29vZFxuICAgICAgICAvLyByZWFzb24gZm9yIGl0LiBoYW5kbGUgZ3JhY2VmdWxseS5cbiAgICAgICAgbm90aWNlcy5hZGRCb290c3RyYXBwZWRFbnZpcm9ubWVudCh7IGJvb3RzdHJhcFN0YWNrVmVyc2lvbjogdmVyc2lvbiwgZW52aXJvbm1lbnQgfSk7XG4gICAgICB9XG4gICAgICBpZiAoZGVmRXhwZWN0ZWRWZXJzaW9uID4gdmVyc2lvbikge1xuICAgICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKFxuICAgICAgICAgIGBUaGlzIENESyBkZXBsb3ltZW50IHJlcXVpcmVzIGJvb3RzdHJhcCBzdGFjayB2ZXJzaW9uICcke2V4cGVjdGVkVmVyc2lvbn0nLCBmb3VuZCAnJHt2ZXJzaW9ufScuIFBsZWFzZSBydW4gJ2NkayBib290c3RyYXAnLmAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYSB2ZXJzaW9uIGZyb20gYW4gU1NNIHBhcmFtZXRlciwgY2FjaGVkXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgdmVyc2lvbkZyb21Tc21QYXJhbWV0ZXIocGFyYW1ldGVyTmFtZTogc3RyaW5nKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuY2FjaGUuc3NtUGFyYW1ldGVycy5nZXQocGFyYW1ldGVyTmFtZSk7XG4gICAgaWYgKGV4aXN0aW5nICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBleGlzdGluZztcbiAgICB9XG5cbiAgICBjb25zdCBzc20gPSB0aGlzLnNkay5zc20oKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzc20uZ2V0UGFyYW1ldGVyKHsgTmFtZTogcGFyYW1ldGVyTmFtZSB9KTtcblxuICAgICAgY29uc3QgYXNOdW1iZXIgPSBwYXJzZUludChgJHtyZXN1bHQuUGFyYW1ldGVyPy5WYWx1ZX1gLCAxMCk7XG4gICAgICBpZiAoaXNOYU4oYXNOdW1iZXIpKSB7XG4gICAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYFNTTSBwYXJhbWV0ZXIgJHtwYXJhbWV0ZXJOYW1lfSBub3QgYSBudW1iZXI6ICR7cmVzdWx0LlBhcmFtZXRlcj8uVmFsdWV9YCk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMuY2FjaGUuc3NtUGFyYW1ldGVycy5zZXQocGFyYW1ldGVyTmFtZSwgYXNOdW1iZXIpO1xuICAgICAgcmV0dXJuIGFzTnVtYmVyO1xuICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgaWYgKGUubmFtZSA9PT0gJ1BhcmFtZXRlck5vdEZvdW5kJykge1xuICAgICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKFxuICAgICAgICAgIGBTU00gcGFyYW1ldGVyICR7cGFyYW1ldGVyTmFtZX0gbm90IGZvdW5kLiBIYXMgdGhlIGVudmlyb25tZW50IGJlZW4gYm9vdHN0cmFwcGVkPyBQbGVhc2UgcnVuIFxcJ2NkayBib290c3RyYXBcXCcgKHNlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vY2RrL2xhdGVzdC9ndWlkZS9ib290c3RyYXBwaW5nLmh0bWwpYCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIGFzeW5jIHByZXBhcmVFY3JSZXBvc2l0b3J5KHJlcG9zaXRvcnlOYW1lOiBzdHJpbmcpOiBQcm9taXNlPEVjclJlcG9zaXRvcnlJbmZvPiB7XG4gICAgaWYgKCF0aGlzLnNkaykge1xuICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcignVG9vbGtpdEluZm8gbmVlZHMgdG8gaGF2ZSBiZWVuIGluaXRpYWxpemVkIHdpdGggYW4gc2RrIHRvIGNhbGwgcHJlcGFyZUVjclJlcG9zaXRvcnknKTtcbiAgICB9XG4gICAgY29uc3QgZWNyID0gdGhpcy5zZGsuZWNyKCk7XG5cbiAgICAvLyBjaGVjayBpZiByZXBvIGFscmVhZHkgZXhpc3RzXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYCR7cmVwb3NpdG9yeU5hbWV9OiBjaGVja2luZyBpZiBFQ1IgcmVwb3NpdG9yeSBhbHJlYWR5IGV4aXN0c2ApKTtcbiAgICAgIGNvbnN0IGRlc2NyaWJlUmVzcG9uc2UgPSBhd2FpdCBlY3IuZGVzY3JpYmVSZXBvc2l0b3JpZXMoe1xuICAgICAgICByZXBvc2l0b3J5TmFtZXM6IFtyZXBvc2l0b3J5TmFtZV0sXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmVwb3NpdG9yeVVyaSA9IGRlc2NyaWJlUmVzcG9uc2UucmVwb3NpdG9yaWVzIVswXT8ucmVwb3NpdG9yeVVyaTtcbiAgICAgIGlmIChleGlzdGluZ1JlcG9zaXRvcnlVcmkpIHtcbiAgICAgICAgcmV0dXJuIHsgcmVwb3NpdG9yeVVyaTogZXhpc3RpbmdSZXBvc2l0b3J5VXJpIH07XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICBpZiAoZS5uYW1lICE9PSAnUmVwb3NpdG9yeU5vdEZvdW5kRXhjZXB0aW9uJykge1xuICAgICAgICB0aHJvdyBlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIGNyZWF0ZSB0aGUgcmVwbyAodGFnIGl0IHNvIGl0IHdpbGwgYmUgZWFzaWVyIHRvIGdhcmJhZ2UgY29sbGVjdCBpbiB0aGUgZnV0dXJlKVxuICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYCR7cmVwb3NpdG9yeU5hbWV9OiBjcmVhdGluZyBFQ1IgcmVwb3NpdG9yeWApKTtcbiAgICBjb25zdCBhc3NldFRhZyA9IHsgS2V5OiAnYXdzY2RrOmFzc2V0JywgVmFsdWU6ICd0cnVlJyB9O1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZWNyLmNyZWF0ZVJlcG9zaXRvcnkoe1xuICAgICAgcmVwb3NpdG9yeU5hbWUsXG4gICAgICB0YWdzOiBbYXNzZXRUYWddLFxuICAgIH0pO1xuICAgIGNvbnN0IHJlcG9zaXRvcnlVcmkgPSByZXNwb25zZS5yZXBvc2l0b3J5Py5yZXBvc2l0b3J5VXJpO1xuICAgIGlmICghcmVwb3NpdG9yeVVyaSkge1xuICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihgQ3JlYXRlUmVwb3NpdG9yeSBkaWQgbm90IHJldHVybiBhIHJlcG9zaXRvcnkgVVJJIGZvciAke3JlcG9zaXRvcnlVcml9YCk7XG4gICAgfVxuXG4gICAgLy8gY29uZmlndXJlIGltYWdlIHNjYW5uaW5nIG9uIHB1c2ggKGhlbHBzIGluIGlkZW50aWZ5aW5nIHNvZnR3YXJlIHZ1bG5lcmFiaWxpdGllcywgbm8gYWRkaXRpb25hbCBjaGFyZ2UpXG4gICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtyZXBvc2l0b3J5TmFtZX06IGVuYWJsZSBpbWFnZSBzY2FubmluZ2ApKTtcbiAgICBhd2FpdCBlY3IucHV0SW1hZ2VTY2FubmluZ0NvbmZpZ3VyYXRpb24oe1xuICAgICAgcmVwb3NpdG9yeU5hbWUsXG4gICAgICBpbWFnZVNjYW5uaW5nQ29uZmlndXJhdGlvbjogeyBzY2FuT25QdXNoOiB0cnVlIH0sXG4gICAgfSk7XG5cbiAgICByZXR1cm4geyByZXBvc2l0b3J5VXJpIH07XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIE5vQm9vdHN0cmFwU3RhY2tFbnZpcm9ubWVudFJlc291cmNlcyBleHRlbmRzIEVudmlyb25tZW50UmVzb3VyY2VzIHtcbiAgY29uc3RydWN0b3IoZW52aXJvbm1lbnQ6IEVudmlyb25tZW50LCBzZGs6IFNESywgaW9IZWxwZXI6IElvSGVscGVyKSB7XG4gICAgc3VwZXIoZW52aXJvbm1lbnQsIHNkaywgaW9IZWxwZXIsIGVtcHR5Q2FjaGUoKSk7XG4gIH1cblxuICAvKipcbiAgICogTG9vayB1cCB0aGUgdG9vbGtpdCBmb3IgYSBnaXZlbiBlbnZpcm9ubWVudCwgdXNpbmcgYSBnaXZlbiBTREtcbiAgICovXG4gIHB1YmxpYyBhc3luYyBsb29rdXBUb29sa2l0KCk6IFByb21pc2U8VG9vbGtpdEluZm8+IHtcbiAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKFxuICAgICAgJ1RyeWluZyB0byBwZXJmb3JtIGFuIG9wZXJhdGlvbiB0aGF0IHJlcXVpcmVzIGEgYm9vdHN0cmFwIHN0YWNrOyB5b3Ugc2hvdWxkIG5vdCBzZWUgdGhpcyBlcnJvciwgdGhpcyBpcyBhIGJ1ZyBpbiB0aGUgQ0RLIENMSS4nLFxuICAgICk7XG4gIH1cbn1cblxuLyoqXG4gKiBEYXRhIHRoYXQgaXMgY2FjaGVkIG9uIGEgcGVyLWVudmlyb25tZW50IGxldmVsXG4gKlxuICogVGhpcyBjYWNoZSBtYXkgYmUgc2hhcmVkIGJldHdlZW4gZGlmZmVyZW50IGluc3RhbmNlcyBvZiB0aGUgYEVudmlyb25tZW50UmVzb3VyY2VzYCBjbGFzcy5cbiAqL1xuaW50ZXJmYWNlIEVudmlyb25tZW50Q2FjaGUge1xuICByZWFkb25seSBzc21QYXJhbWV0ZXJzOiBNYXA8c3RyaW5nLCBudW1iZXI+O1xuICB0b29sa2l0SW5mbz86IFRvb2xraXRJbmZvO1xufVxuXG5mdW5jdGlvbiBlbXB0eUNhY2hlKCk6IEVudmlyb25tZW50Q2FjaGUge1xuICByZXR1cm4ge1xuICAgIHNzbVBhcmFtZXRlcnM6IG5ldyBNYXAoKSxcbiAgICB0b29sa2l0SW5mbzogdW5kZWZpbmVkLFxuICB9O1xufVxuXG4vKipcbiAqIFRoZSBib290c3RyYXAgdGVtcGxhdGUgdmVyc2lvbiB0aGF0IGludHJvZHVjZWQgc3NtOkdldFBhcmFtZXRlclxuICovXG5jb25zdCBCT09UU1RSQVBfVEVNUExBVEVfVkVSU0lPTl9JTlRST0RVQ0lOR19HRVRQQVJBTUVURVIgPSA1O1xuIl19