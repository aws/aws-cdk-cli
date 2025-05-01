"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SdkProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SdkProvider = void 0;
exports.initContextProviderSdk = initContextProviderSdk;
const os = require("os");
const cx_api_1 = require("@aws-cdk/cx-api");
const credential_providers_1 = require("@aws-sdk/credential-providers");
const awscli_compatible_1 = require("./awscli-compatible");
const cached_1 = require("./cached");
const credential_plugins_1 = require("./credential-plugins");
const provider_caching_1 = require("./provider-caching");
const sdk_1 = require("./sdk");
const tracing_1 = require("./tracing");
const util_1 = require("../../util");
const private_1 = require("../io/private");
const plugin_1 = require("../plugin");
const toolkit_error_1 = require("../toolkit-error");
const CACHED_ACCOUNT = Symbol('cached_account');
/**
 * Creates instances of the AWS SDK appropriate for a given account/region.
 *
 * Behavior is as follows:
 *
 * - First, a set of "base" credentials are established
 *   - If a target environment is given and the default ("current") SDK credentials are for
 *     that account, return those; otherwise
 *   - If a target environment is given, scan all credential provider plugins
 *     for credentials, and return those if found; otherwise
 *   - Return default ("current") SDK credentials, noting that they might be wrong.
 *
 * - Second, a role may optionally need to be assumed. Use the base credentials
 *   established in the previous process to assume that role.
 *   - If assuming the role fails and the base credentials are for the correct
 *     account, return those. This is a fallback for people who are trying to interact
 *     with a Default Synthesized stack and already have right credentials setup.
 *
 *     Typical cases we see in the wild:
 *     - Credential plugin setup that, although not recommended, works for them
 *     - Seeded terminal with `ReadOnly` credentials in order to do `cdk diff`--the `ReadOnly`
 *       role doesn't have `sts:AssumeRole` and will fail for no real good reason.
 */
let SdkProvider = SdkProvider_1 = class SdkProvider {
    /**
     * Create a new SdkProvider which gets its defaults in a way that behaves like the AWS CLI does
     *
     * The AWS SDK for JS behaves slightly differently from the AWS CLI in a number of ways; see the
     * class `AwsCliCompatible` for the details.
     */
    static async withAwsCliCompatibleDefaults(options) {
        (0, tracing_1.callTrace)(SdkProvider_1.withAwsCliCompatibleDefaults.name, SdkProvider_1.constructor.name, options.logger);
        const config = await new awscli_compatible_1.AwsCliCompatible(options.ioHelper, options.requestHandler ?? {}, options.logger).baseConfig(options.profile);
        return new SdkProvider_1(config.credentialProvider, config.defaultRegion, options);
    }
    defaultRegion;
    defaultCredentialProvider;
    plugins;
    requestHandler;
    ioHelper;
    logger;
    constructor(defaultCredentialProvider, defaultRegion, services) {
        this.defaultCredentialProvider = defaultCredentialProvider;
        this.defaultRegion = defaultRegion ?? 'us-east-1';
        this.requestHandler = services.requestHandler ?? {};
        this.ioHelper = services.ioHelper;
        this.logger = services.logger;
        this.plugins = new credential_plugins_1.CredentialPlugins(services.pluginHost ?? new plugin_1.PluginHost(), this.ioHelper);
    }
    /**
     * Return an SDK which can do operations in the given environment
     *
     * The `environment` parameter is resolved first (see `resolveEnvironment()`).
     */
    async forEnvironment(environment, mode, options, quiet = false) {
        const env = await this.resolveEnvironment(environment);
        const baseCreds = await this.obtainBaseCredentials(env.account, mode);
        // At this point, we need at least SOME credentials
        if (baseCreds.source === 'none') {
            throw new toolkit_error_1.AuthenticationError(fmtObtainCredentialsError(env.account, baseCreds));
        }
        // Simple case is if we don't need to "assumeRole" here. If so, we must now have credentials for the right
        // account.
        if (options?.assumeRoleArn === undefined) {
            if (baseCreds.source === 'incorrectDefault') {
                throw new toolkit_error_1.AuthenticationError(fmtObtainCredentialsError(env.account, baseCreds));
            }
            // Our current credentials must be valid and not expired. Confirm that before we get into doing
            // actual CloudFormation calls, which might take a long time to hang.
            const sdk = this._makeSdk(baseCreds.credentials, env.region);
            await sdk.validateCredentials();
            return { sdk, didAssumeRole: false };
        }
        try {
            // We will proceed to AssumeRole using whatever we've been given.
            const sdk = await this.withAssumedRole(baseCreds, options.assumeRoleArn, options.assumeRoleExternalId, options.assumeRoleAdditionalOptions, env.region);
            return { sdk, didAssumeRole: true };
        }
        catch (err) {
            if (err.name === 'ExpiredToken') {
                throw err;
            }
            // AssumeRole failed. Proceed and warn *if and only if* the baseCredentials were already for the right account
            // or returned from a plugin. This is to cover some current setups for people using plugins or preferring to
            // feed the CLI credentials which are sufficient by themselves. Prefer to assume the correct role if we can,
            // but if we can't then let's just try with available credentials anyway.
            if (baseCreds.source === 'correctDefault' || baseCreds.source === 'plugin') {
                await this.ioHelper.notify(private_1.IO.DEFAULT_SDK_DEBUG.msg(err.message));
                const maker = quiet ? private_1.IO.DEFAULT_SDK_DEBUG : private_1.IO.DEFAULT_SDK_WARN;
                await this.ioHelper.notify(maker.msg(`${fmtObtainedCredentials(baseCreds)} could not be used to assume '${options.assumeRoleArn}', but are for the right account. Proceeding anyway.`));
                return {
                    sdk: this._makeSdk(baseCreds.credentials, env.region),
                    didAssumeRole: false,
                };
            }
            throw err;
        }
    }
    /**
     * Return the partition that base credentials are for
     *
     * Returns `undefined` if there are no base credentials.
     */
    async baseCredentialsPartition(environment, mode) {
        const env = await this.resolveEnvironment(environment);
        const baseCreds = await this.obtainBaseCredentials(env.account, mode);
        if (baseCreds.source === 'none') {
            return undefined;
        }
        return (await this._makeSdk(baseCreds.credentials, env.region).currentAccount()).partition;
    }
    /**
     * Resolve the environment for a stack
     *
     * Replaces the magic values `UNKNOWN_REGION` and `UNKNOWN_ACCOUNT`
     * with the defaults for the current SDK configuration (`~/.aws/config` or
     * otherwise).
     *
     * It is an error if `UNKNOWN_ACCOUNT` is used but the user hasn't configured
     * any SDK credentials.
     */
    async resolveEnvironment(env) {
        const region = env.region !== cx_api_1.UNKNOWN_REGION ? env.region : this.defaultRegion;
        const account = env.account !== cx_api_1.UNKNOWN_ACCOUNT ? env.account : (await this.defaultAccount())?.accountId;
        if (!account) {
            throw new toolkit_error_1.AuthenticationError('Unable to resolve AWS account to use. It must be either configured when you define your CDK Stack, or through the environment');
        }
        return {
            region,
            account,
            name: cx_api_1.EnvironmentUtils.format(account, region),
        };
    }
    /**
     * The account we'd auth into if we used default credentials.
     *
     * Default credentials are the set of ambiently configured credentials using
     * one of the environment variables, or ~/.aws/credentials, or the *one*
     * profile that was passed into the CLI.
     *
     * Might return undefined if there are no default/ambient credentials
     * available (in which case the user should better hope they have
     * credential plugins configured).
     *
     * Uses a cache to avoid STS calls if we don't need 'em.
     */
    async defaultAccount() {
        return (0, cached_1.cached)(this, CACHED_ACCOUNT, async () => {
            try {
                return await this._makeSdk(this.defaultCredentialProvider, this.defaultRegion).currentAccount();
            }
            catch (e) {
                // Treat 'ExpiredToken' specially. This is a common situation that people may find themselves in, and
                // they are complaining about if we fail 'cdk synth' on them. We loudly complain in order to show that
                // the current situation is probably undesirable, but we don't fail.
                if (e.name === 'ExpiredToken') {
                    await this.ioHelper.notify(private_1.IO.DEFAULT_SDK_WARN.msg('There are expired AWS credentials in your environment. The CDK app will synth without current account information.'));
                    return undefined;
                }
                await this.ioHelper.notify(private_1.IO.DEFAULT_SDK_DEBUG.msg(`Unable to determine the default AWS account (${e.name}): ${(0, util_1.formatErrorMessage)(e)}`));
                return undefined;
            }
        });
    }
    /**
     * Get credentials for the given account ID in the given mode
     *
     * 1. Use the default credentials if the destination account matches the
     *    current credentials' account.
     * 2. Otherwise try all credential plugins.
     * 3. Fail if neither of these yield any credentials.
     * 4. Return a failure if any of them returned credentials
     */
    async obtainBaseCredentials(accountId, mode) {
        // First try 'current' credentials
        const defaultAccountId = (await this.defaultAccount())?.accountId;
        if (defaultAccountId === accountId) {
            return {
                source: 'correctDefault',
                credentials: await this.defaultCredentialProvider,
            };
        }
        // Then try the plugins
        const pluginCreds = await this.plugins.fetchCredentialsFor(accountId, mode);
        if (pluginCreds) {
            return { source: 'plugin', ...pluginCreds };
        }
        // Fall back to default credentials with a note that they're not the right ones yet
        if (defaultAccountId !== undefined) {
            return {
                source: 'incorrectDefault',
                accountId: defaultAccountId,
                credentials: await this.defaultCredentialProvider,
                unusedPlugins: this.plugins.availablePluginNames,
            };
        }
        // Apparently we didn't find any at all
        return {
            source: 'none',
            unusedPlugins: this.plugins.availablePluginNames,
        };
    }
    /**
     * Return an SDK which uses assumed role credentials
     *
     * The base credentials used to retrieve the assumed role credentials will be the
     * same credentials returned by obtainCredentials if an environment and mode is passed,
     * otherwise it will be the current credentials.
     */
    async withAssumedRole(mainCredentials, roleArn, externalId, additionalOptions, region) {
        await this.ioHelper.notify(private_1.IO.DEFAULT_SDK_DEBUG.msg(`Assuming role '${roleArn}'.`));
        region = region ?? this.defaultRegion;
        const sourceDescription = fmtObtainedCredentials(mainCredentials);
        try {
            const credentials = await (0, provider_caching_1.makeCachingProvider)((0, credential_providers_1.fromTemporaryCredentials)({
                masterCredentials: mainCredentials.credentials,
                params: {
                    RoleArn: roleArn,
                    ExternalId: externalId,
                    RoleSessionName: `aws-cdk-${safeUsername()}`,
                    ...additionalOptions,
                    TransitiveTagKeys: additionalOptions?.Tags ? additionalOptions.Tags.map((t) => t.Key) : undefined,
                },
                clientConfig: {
                    region,
                    requestHandler: this.requestHandler,
                    customUserAgent: 'aws-cdk',
                    logger: this.logger,
                },
                logger: this.logger,
            }));
            // Call the provider at least once here, to catch an error if it occurs
            await credentials();
            return this._makeSdk(credentials, region);
        }
        catch (err) {
            if (err.name === 'ExpiredToken') {
                throw err;
            }
            await this.ioHelper.notify(private_1.IO.DEFAULT_SDK_DEBUG.msg(`Assuming role failed: ${err.message}`));
            throw new toolkit_error_1.AuthenticationError([
                'Could not assume role in target account',
                ...(sourceDescription ? [`using ${sourceDescription}`] : []),
                err.message,
                ". Please make sure that this role exists in the account. If it doesn't exist, (re)-bootstrap the environment " +
                    "with the right '--trust', using the latest version of the CDK CLI.",
            ].join(' '));
        }
    }
    /**
     * Factory function that creates a new SDK instance
     *
     * This is a function here, instead of all the places where this is used creating a `new SDK`
     * instance, so that it is trivial to mock from tests.
     *
     * Use like this:
     *
     * ```ts
     * const mockSdk = jest.spyOn(SdkProvider.prototype, '_makeSdk').mockReturnValue(new MockSdk());
     * // ...
     * mockSdk.mockRestore();
     * ```
     *
     * @internal
     */
    _makeSdk(credProvider, region) {
        return new sdk_1.SDK(credProvider, region, this.requestHandler, this.ioHelper, this.logger);
    }
};
exports.SdkProvider = SdkProvider;
exports.SdkProvider = SdkProvider = SdkProvider_1 = __decorate([
    tracing_1.traceMemberMethods
], SdkProvider);
/**
 * Return the username with characters invalid for a RoleSessionName removed
 *
 * @see https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html#API_AssumeRole_RequestParameters
 */
function safeUsername() {
    try {
        return os.userInfo().username.replace(/[^\w+=,.@-]/g, '@');
    }
    catch {
        return 'noname';
    }
}
/**
 * Isolating the code that translates calculation errors into human error messages
 *
 * We cover the following cases:
 *
 * - No credentials are available at all
 * - Default credentials are for the wrong account
 */
function fmtObtainCredentialsError(targetAccountId, obtainResult) {
    const msg = [`Need to perform AWS calls for account ${targetAccountId}`];
    switch (obtainResult.source) {
        case 'incorrectDefault':
            msg.push(`but the current credentials are for ${obtainResult.accountId}`);
            break;
        case 'none':
            msg.push('but no credentials have been configured');
    }
    if (obtainResult.unusedPlugins.length > 0) {
        msg.push(`and none of these plugins found any: ${obtainResult.unusedPlugins.join(', ')}`);
    }
    return msg.join(', ');
}
/**
 * Format a message indicating where we got base credentials for the assume role
 *
 * We cover the following cases:
 *
 * - Default credentials for the right account
 * - Default credentials for the wrong account
 * - Credentials returned from a plugin
 */
function fmtObtainedCredentials(obtainResult) {
    switch (obtainResult.source) {
        case 'correctDefault':
            return 'current credentials';
        case 'plugin':
            return `credentials returned by plugin '${obtainResult.pluginName}'`;
        case 'incorrectDefault':
            const msg = [];
            msg.push(`current credentials (which are for account ${obtainResult.accountId}`);
            if (obtainResult.unusedPlugins.length > 0) {
                msg.push(`, and none of the following plugins provided credentials: ${obtainResult.unusedPlugins.join(', ')}`);
            }
            msg.push(')');
            return msg.join('');
    }
}
/**
 * Instantiate an SDK for context providers. This function ensures that all
 * lookup assume role options are used when context providers perform lookups.
 */
async function initContextProviderSdk(aws, options) {
    const account = options.account;
    const region = options.region;
    const creds = {
        assumeRoleArn: options.lookupRoleArn,
        assumeRoleExternalId: options.lookupRoleExternalId,
        assumeRoleAdditionalOptions: options.assumeRoleAdditionalOptions,
    };
    return (await aws.forEnvironment(cx_api_1.EnvironmentUtils.make(account, region), plugin_1.Mode.ForReading, creds)).sdk;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2RrLXByb3ZpZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9hd3MtYXV0aC9zZGstcHJvdmlkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7OztBQXdoQkEsd0RBV0M7QUFuaUJELHlCQUF5QjtBQUd6Qiw0Q0FBb0Y7QUFFcEYsd0VBQXlFO0FBR3pFLDJEQUF1RDtBQUN2RCxxQ0FBa0M7QUFDbEMsNkRBQXlEO0FBQ3pELHlEQUF5RDtBQUN6RCwrQkFBNEI7QUFDNUIsdUNBQTBEO0FBQzFELHFDQUFnRDtBQUNoRCwyQ0FBa0Q7QUFDbEQsc0NBQTZDO0FBQzdDLG9EQUF1RDtBQW1DdkQsTUFBTSxjQUFjLEdBQUcsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUE2QmhEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBc0JHO0FBRUksSUFBTSxXQUFXLG1CQUFqQixNQUFNLFdBQVc7SUFDdEI7Ozs7O09BS0c7SUFDSSxNQUFNLENBQUMsS0FBSyxDQUFDLDRCQUE0QixDQUFDLE9BQTJCO1FBQzFFLElBQUEsbUJBQVMsRUFBQyxhQUFXLENBQUMsNEJBQTRCLENBQUMsSUFBSSxFQUFFLGFBQVcsQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUN2RyxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksb0NBQWdCLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxPQUFPLENBQUMsY0FBYyxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUN0SSxPQUFPLElBQUksYUFBVyxDQUFDLE1BQU0sQ0FBQyxrQkFBa0IsRUFBRSxNQUFNLENBQUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ25GLENBQUM7SUFFZSxhQUFhLENBQVM7SUFDckIseUJBQXlCLENBQWdDO0lBQ3pELE9BQU8s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QUksQ0FBQyw4Q0FBOEMsWUFBWSxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUM7WUFFakYsSUFBSSxZQUFZLENBQUMsYUFBYSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDMUMsR0FBRyxDQUFDLElBQUksQ0FBQyw2REFBNkQsWUFBWSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ2pILENBQUM7WUFDRCxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBRWQsT0FBTyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3hCLENBQUM7QUFDSCxDQUFDO0FBRUQ7OztHQUdHO0FBQ0ksS0FBSyxVQUFVLHNCQUFzQixDQUFDLEdBQWdCLEVBQUUsT0FBaUM7SUFDOUYsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQztJQUNoQyxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDO0lBRTlCLE1BQU0sS0FBSyxHQUF1QjtRQUNoQyxhQUFhLEVBQUUsT0FBTyxDQUFDLGFBQWE7UUFDcEMsb0JBQW9CLEVBQUUsT0FBTyxDQUFDLG9CQUFvQjtRQUNsRCwyQkFBMkIsRUFBRSxPQUFPLENBQUMsMkJBQTJCO0tBQ2pFLENBQUM7SUFFRixPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsY0FBYyxDQUFDLHlCQUFnQixDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLEVBQUUsYUFBSSxDQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQztBQUN4RyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgb3MgZnJvbSAnb3MnO1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0TG9va3VwUm9sZU9wdGlvbnMgfSBmcm9tICdAYXdzLWNkay9jbG91ZC1hc3NlbWJseS1zY2hlbWEnO1xuaW1wb3J0IHR5cGUgeyBFbnZpcm9ubWVudCB9IGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgeyBFbnZpcm9ubWVudFV0aWxzLCBVTktOT1dOX0FDQ09VTlQsIFVOS05PV05fUkVHSU9OIH0gZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCB0eXBlIHsgQXNzdW1lUm9sZUNvbW1hbmRJbnB1dCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zdHMnO1xuaW1wb3J0IHsgZnJvbVRlbXBvcmFyeUNyZWRlbnRpYWxzIH0gZnJvbSAnQGF3cy1zZGsvY3JlZGVudGlhbC1wcm92aWRlcnMnO1xuaW1wb3J0IHR5cGUgeyBOb2RlSHR0cEhhbmRsZXJPcHRpb25zIH0gZnJvbSAnQHNtaXRoeS9ub2RlLWh0dHAtaGFuZGxlcic7XG5pbXBvcnQgdHlwZSB7IEF3c0NyZWRlbnRpYWxJZGVudGl0eVByb3ZpZGVyLCBMb2dnZXIgfSBmcm9tICdAc21pdGh5L3R5cGVzJztcbmltcG9ydCB7IEF3c0NsaUNvbXBhdGlibGUgfSBmcm9tICcuL2F3c2NsaS1jb21wYXRpYmxlJztcbmltcG9ydCB7IGNhY2hlZCB9IGZyb20gJy4vY2FjaGVkJztcbmltcG9ydCB7IENyZWRlbnRpYWxQbHVnaW5zIH0gZnJvbSAnLi9jcmVkZW50aWFsLXBsdWdpbnMnO1xuaW1wb3J0IHsgbWFrZUNhY2hpbmdQcm92aWRlciB9IGZyb20gJy4vcHJvdmlkZXItY2FjaGluZyc7XG5pbXBvcnQgeyBTREsgfSBmcm9tICcuL3Nkayc7XG5pbXBvcnQgeyBjYWxsVHJhY2UsIHRyYWNlTWVtYmVyTWV0aG9kcyB9IGZyb20gJy4vdHJhY2luZyc7XG5pbXBvcnQgeyBmb3JtYXRFcnJvck1lc3NhZ2UgfSBmcm9tICcuLi8uLi91dGlsJztcbmltcG9ydCB7IElPLCB0eXBlIElvSGVscGVyIH0gZnJvbSAnLi4vaW8vcHJpdmF0ZSc7XG5pbXBvcnQgeyBQbHVnaW5Ib3N0LCBNb2RlIH0gZnJvbSAnLi4vcGx1Z2luJztcbmltcG9ydCB7IEF1dGhlbnRpY2F0aW9uRXJyb3IgfSBmcm9tICcuLi90b29sa2l0LWVycm9yJztcblxuZXhwb3J0IHR5cGUgQXNzdW1lUm9sZUFkZGl0aW9uYWxPcHRpb25zID0gUGFydGlhbDxPbWl0PEFzc3VtZVJvbGVDb21tYW5kSW5wdXQsICdFeHRlcm5hbElkJyB8ICdSb2xlQXJuJz4+O1xuXG4vKipcbiAqIE9wdGlvbnMgZm9yIHRoZSBkZWZhdWx0IFNESyBwcm92aWRlclxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNka1Byb3ZpZGVyT3B0aW9ucyBleHRlbmRzIFNka1Byb3ZpZGVyU2VydmljZXMge1xuICAvKipcbiAgICogUHJvZmlsZSB0byByZWFkIGZyb20gfi8uYXdzXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gTm8gcHJvZmlsZVxuICAgKi9cbiAgcmVhZG9ubHkgcHJvZmlsZT86IHN0cmluZztcbn1cblxuLyoqXG4gKiBPcHRpb25zIGZvciBpbmRpdmlkdWFsIFNES3NcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTZGtIdHRwT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBQcm94eSBhZGRyZXNzIHRvIHVzZVxuICAgKlxuICAgKiBAZGVmYXVsdCBObyBwcm94eVxuICAgKi9cbiAgcmVhZG9ubHkgcHJveHlBZGRyZXNzPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBBIHBhdGggdG8gYSBjZXJ0aWZpY2F0ZSBidW5kbGUgdGhhdCBjb250YWlucyBhIGNlcnQgdG8gYmUgdHJ1c3RlZC5cbiAgICpcbiAgICogQGRlZmF1bHQgTm8gY2VydGlmaWNhdGUgYnVuZGxlXG4gICAqL1xuICByZWFkb25seSBjYUJ1bmRsZVBhdGg/OiBzdHJpbmc7XG59XG5cbmNvbnN0IENBQ0hFRF9BQ0NPVU5UID0gU3ltYm9sKCdjYWNoZWRfYWNjb3VudCcpO1xuXG4vKipcbiAqIFNESyBjb25maWd1cmF0aW9uIGZvciBhIGdpdmVuIGVudmlyb25tZW50XG4gKiAnZm9yRW52aXJvbm1lbnQnIHdpbGwgYXR0ZW1wdCB0byBhc3N1bWUgYSByb2xlIGFuZCBpZiBpdFxuICogaXMgbm90IHN1Y2Nlc3NmdWwsIHRoZW4gaXQgd2lsbCBlaXRoZXI6XG4gKiAgIDEuIENoZWNrIHRvIHNlZSBpZiB0aGUgZGVmYXVsdCBjcmVkZW50aWFscyAobG9jYWwgY3JlZGVudGlhbHMgdGhlIENMSSB3YXMgZXhlY3V0ZWQgd2l0aClcbiAqICAgICAgYXJlIGZvciB0aGUgZ2l2ZW4gZW52aXJvbm1lbnQuIElmIHRoZXkgYXJlIHRoZW4gcmV0dXJuIHRob3NlLlxuICogICAyLiBJZiB0aGUgZGVmYXVsdCBjcmVkZW50aWFscyBhcmUgbm90IGZvciB0aGUgZ2l2ZW4gZW52aXJvbm1lbnQgdGhlblxuICogICAgICB0aHJvdyBhbiBlcnJvclxuICpcbiAqICdkaWRBc3N1bWVSb2xlJyBhbGxvd3MgY2FsbGVycyB0byB3aGV0aGVyIHRoZXkgYXJlIHJlY2VpdmluZyB0aGUgYXNzdW1lIHJvbGVcbiAqIGNyZWRlbnRpYWxzIG9yIHRoZSBkZWZhdWx0IGNyZWRlbnRpYWxzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNka0ZvckVudmlyb25tZW50IHtcbiAgLyoqXG4gICAqIFRoZSBTREsgZm9yIHRoZSBnaXZlbiBlbnZpcm9ubWVudFxuICAgKi9cbiAgcmVhZG9ubHkgc2RrOiBTREs7XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgb3Igbm90IHRoZSBhc3N1bWUgcm9sZSB3YXMgc3VjY2Vzc2Z1bC5cbiAgICogSWYgdGhlIGFzc3VtZSByb2xlIHdhcyBub3Qgc3VjY2Vzc2Z1bCAoZmFsc2UpXG4gICAqIHRoZW4gdGhhdCBtZWFucyB0aGF0IHRoZSAnc2RrJyByZXR1cm5lZCBjb250YWluc1xuICAgKiB0aGUgZGVmYXVsdCBjcmVkZW50aWFscyAobm90IHRoZSBhc3N1bWUgcm9sZSBjcmVkZW50aWFscylcbiAgICovXG4gIHJlYWRvbmx5IGRpZEFzc3VtZVJvbGU6IGJvb2xlYW47XG59XG5cbi8qKlxuICogQ3JlYXRlcyBpbnN0YW5jZXMgb2YgdGhlIEFXUyBTREsgYXBwcm9wcmlhdGUgZm9yIGEgZ2l2ZW4gYWNjb3VudC9yZWdpb24uXG4gKlxuICogQmVoYXZpb3IgaXMgYXMgZm9sbG93czpcbiAqXG4gKiAtIEZpcnN0LCBhIHNldCBvZiBcImJhc2VcIiBjcmVkZW50aWFscyBhcmUgZXN0YWJsaXNoZWRcbiAqICAgLSBJZiBhIHRhcmdldCBlbnZpcm9ubWVudCBpcyBnaXZlbiBhbmQgdGhlIGRlZmF1bHQgKFwiY3VycmVudFwiKSBTREsgY3JlZGVudGlhbHMgYXJlIGZvclxuICogICAgIHRoYXQgYWNjb3VudCwgcmV0dXJuIHRob3NlOyBvdGhlcndpc2VcbiAqICAgLSBJZiBhIHRhcmdldCBlbnZpcm9ubWVudCBpcyBnaXZlbiwgc2NhbiBhbGwgY3JlZGVudGlhbCBwcm92aWRlciBwbHVnaW5zXG4gKiAgICAgZm9yIGNyZWRlbnRpYWxzLCBhbmQgcmV0dXJuIHRob3NlIGlmIGZvdW5kOyBvdGhlcndpc2VcbiAqICAgLSBSZXR1cm4gZGVmYXVsdCAoXCJjdXJyZW50XCIpIFNESyBjcmVkZW50aWFscywgbm90aW5nIHRoYXQgdGhleSBtaWdodCBiZSB3cm9uZy5cbiAqXG4gKiAtIFNlY29uZCwgYSByb2xlIG1heSBvcHRpb25hbGx5IG5lZWQgdG8gYmUgYXNzdW1lZC4gVXNlIHRoZSBiYXNlIGNyZWRlbnRpYWxzXG4gKiAgIGVzdGFibGlzaGVkIGluIHRoZSBwcmV2aW91cyBwcm9jZXNzIHRvIGFzc3VtZSB0aGF0IHJvbGUuXG4gKiAgIC0gSWYgYXNzdW1pbmcgdGhlIHJvbGUgZmFpbHMgYW5kIHRoZSBiYXNlIGNyZWRlbnRpYWxzIGFyZSBmb3IgdGhlIGNvcnJlY3RcbiAqICAgICBhY2NvdW50LCByZXR1cm4gdGhvc2UuIFRoaXMgaXMgYSBmYWxsYmFjayBmb3IgcGVvcGxlIHdobyBhcmUgdHJ5aW5nIHRvIGludGVyYWN0XG4gKiAgICAgd2l0aCBhIERlZmF1bHQgU3ludGhlc2l6ZWQgc3RhY2sgYW5kIGFscmVhZHkgaGF2ZSByaWdodCBjcmVkZW50aWFscyBzZXR1cC5cbiAqXG4gKiAgICAgVHlwaWNhbCBjYXNlcyB3ZSBzZWUgaW4gdGhlIHdpbGQ6XG4gKiAgICAgLSBDcmVkZW50aWFsIHBsdWdpbiBzZXR1cCB0aGF0LCBhbHRob3VnaCBub3QgcmVjb21tZW5kZWQsIHdvcmtzIGZvciB0aGVtXG4gKiAgICAgLSBTZWVkZWQgdGVybWluYWwgd2l0aCBgUmVhZE9ubHlgIGNyZWRlbnRpYWxzIGluIG9yZGVyIHRvIGRvIGBjZGsgZGlmZmAtLXRoZSBgUmVhZE9ubHlgXG4gKiAgICAgICByb2xlIGRvZXNuJ3QgaGF2ZSBgc3RzOkFzc3VtZVJvbGVgIGFuZCB3aWxsIGZhaWwgZm9yIG5vIHJlYWwgZ29vZCByZWFzb24uXG4gKi9cbkB0cmFjZU1lbWJlck1ldGhvZHNcbmV4cG9ydCBjbGFzcyBTZGtQcm92aWRlciB7XG4gIC8qKlxuICAgKiBDcmVhdGUgYSBuZXcgU2RrUHJvdmlkZXIgd2hpY2ggZ2V0cyBpdHMgZGVmYXVsdHMgaW4gYSB3YXkgdGhhdCBiZWhhdmVzIGxpa2UgdGhlIEFXUyBDTEkgZG9lc1xuICAgKlxuICAgKiBUaGUgQVdTIFNESyBmb3IgSlMgYmVoYXZlcyBzbGlnaHRseSBkaWZmZXJlbnRseSBmcm9tIHRoZSBBV1MgQ0xJIGluIGEgbnVtYmVyIG9mIHdheXM7IHNlZSB0aGVcbiAgICogY2xhc3MgYEF3c0NsaUNvbXBhdGlibGVgIGZvciB0aGUgZGV0YWlscy5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgYXN5bmMgd2l0aEF3c0NsaUNvbXBhdGlibGVEZWZhdWx0cyhvcHRpb25zOiBTZGtQcm92aWRlck9wdGlvbnMpIHtcbiAgICBjYWxsVHJhY2UoU2RrUHJvdmlkZXIud2l0aEF3c0NsaUNvbXBhdGlibGVEZWZhdWx0cy5uYW1lLCBTZGtQcm92aWRlci5jb25zdHJ1Y3Rvci5uYW1lLCBvcHRpb25zLmxvZ2dlcik7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgbmV3IEF3c0NsaUNvbXBhdGlibGUob3B0aW9ucy5pb0hlbHBlciwgb3B0aW9ucy5yZXF1ZXN0SGFuZGxlciA/PyB7fSwgb3B0aW9ucy5sb2dnZXIpLmJhc2VDb25maWcob3B0aW9ucy5wcm9maWxlKTtcbiAgICByZXR1cm4gbmV3IFNka1Byb3ZpZGVyKGNvbmZpZy5jcmVkZW50aWFsUHJvdmlkZXIsIGNvbmZpZy5kZWZhdWx0UmVnaW9uLCBvcHRpb25zKTtcbiAgfVxuXG4gIHB1YmxpYyByZWFkb25seSBkZWZhdWx0UmVnaW9uOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgZGVmYXVsdENyZWRlbnRpYWxQcm92aWRlcjogQXdzQ3JlZGVudGlhbElkZW50aXR5UHJvdmlkZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2lucztcbiAgcHJpdmF0ZSByZWFkb25seSByZXF1ZXN0SGFuZGxlcjogTm9kZUh0dHBIYW5kbGVyT3B0aW9ucztcbiAgcHJpdmF0ZSByZWFkb25seSBpb0hlbHBlcjogSW9IZWxwZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgbG9nZ2VyPzogTG9nZ2VyO1xuXG4gIHB1YmxpYyBjb25zdHJ1Y3RvcihcbiAgICBkZWZhdWx0Q3JlZGVudGlhbFByb3ZpZGVyOiBBd3NDcmVkZW50aWFsSWRlbnRpdHlQcm92aWRlcixcbiAgICBkZWZhdWx0UmVnaW9uOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gICAgc2VydmljZXM6IFNka1Byb3ZpZGVyU2VydmljZXMsXG4gICkge1xuICAgIHRoaXMuZGVmYXVsdENyZWRlbnRpYWxQcm92aWRlciA9IGRlZmF1bHRDcmVkZW50aWFsUHJvdmlkZXI7XG4gICAgdGhpcy5kZWZhdWx0UmVnaW9uID0gZGVmYXVsdFJlZ2lvbiA/PyAndXMtZWFzdC0xJztcbiAgICB0aGlzLnJlcXVlc3RIYW5kbGVyID0gc2VydmljZXMucmVxdWVzdEhhbmRsZXIgPz8ge307XG4gICAgdGhpcy5pb0hlbHBlciA9IHNlcnZpY2VzLmlvSGVscGVyO1xuICAgIHRoaXMubG9nZ2VyID0gc2VydmljZXMubG9nZ2VyO1xuICAgIHRoaXMucGx1Z2lucyA9IG5ldyBDcmVkZW50aWFsUGx1Z2lucyhzZXJ2aWNlcy5wbHVnaW5Ib3N0ID8/IG5ldyBQbHVnaW5Ib3N0KCksIHRoaXMuaW9IZWxwZXIpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybiBhbiBTREsgd2hpY2ggY2FuIGRvIG9wZXJhdGlvbnMgaW4gdGhlIGdpdmVuIGVudmlyb25tZW50XG4gICAqXG4gICAqIFRoZSBgZW52aXJvbm1lbnRgIHBhcmFtZXRlciBpcyByZXNvbHZlZCBmaXJzdCAoc2VlIGByZXNvbHZlRW52aXJvbm1lbnQoKWApLlxuICAgKi9cbiAgcHVibGljIGFzeW5jIGZvckVudmlyb25tZW50KFxuICAgIGVudmlyb25tZW50OiBFbnZpcm9ubWVudCxcbiAgICBtb2RlOiBNb2RlLFxuICAgIG9wdGlvbnM/OiBDcmVkZW50aWFsc09wdGlvbnMsXG4gICAgcXVpZXQgPSBmYWxzZSxcbiAgKTogUHJvbWlzZTxTZGtGb3JFbnZpcm9ubWVudD4ge1xuICAgIGNvbnN0IGVudiA9IGF3YWl0IHRoaXMucmVzb2x2ZUVudmlyb25tZW50KGVudmlyb25tZW50KTtcblxuICAgIGNvbnN0IGJhc2VDcmVkcyA9IGF3YWl0IHRoaXMub2J0YWluQmFzZUNyZWRlbnRpYWxzKGVudi5hY2NvdW50LCBtb2RlKTtcblxuICAgIC8vIEF0IHRoaXMgcG9pbnQsIHdlIG5lZWQgYXQgbGVhc3QgU09NRSBjcmVkZW50aWFsc1xuICAgIGlmIChiYXNlQ3JlZHMuc291cmNlID09PSAnbm9uZScpIHtcbiAgICAgIHRocm93IG5ldyBBdXRoZW50aWNhdGlvbkVycm9yKGZtdE9idGFpbkNyZWRlbnRpYWxzRXJyb3IoZW52LmFjY291bnQsIGJhc2VDcmVkcykpO1xuICAgIH1cblxuICAgIC8vIFNpbXBsZSBjYXNlIGlzIGlmIHdlIGRvbid0IG5lZWQgdG8gXCJhc3N1bWVSb2xlXCIgaGVyZS4gSWYgc28sIHdlIG11c3Qgbm93IGhhdmUgY3JlZGVudGlhbHMgZm9yIHRoZSByaWdodFxuICAgIC8vIGFjY291bnQuXG4gICAgaWYgKG9wdGlvbnM/LmFzc3VtZVJvbGVBcm4gPT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGJhc2VDcmVkcy5zb3VyY2UgPT09ICdpbmNvcnJlY3REZWZhdWx0Jykge1xuICAgICAgICB0aHJvdyBuZXcgQXV0aGVudGljYXRpb25FcnJvcihmbXRPYnRhaW5DcmVkZW50aWFsc0Vycm9yKGVudi5hY2NvdW50LCBiYXNlQ3JlZHMpKTtcbiAgICAgIH1cblxuICAgICAgLy8gT3VyIGN1cnJlbnQgY3JlZGVudGlhbHMgbXVzdCBiZSB2YWxpZCBhbmQgbm90IGV4cGlyZWQuIENvbmZpcm0gdGhhdCBiZWZvcmUgd2UgZ2V0IGludG8gZG9pbmdcbiAgICAgIC8vIGFjdHVhbCBDbG91ZEZvcm1hdGlvbiBjYWxscywgd2hpY2ggbWlnaHQgdGFrZSBhIGxvbmcgdGltZSB0byBoYW5nLlxuICAgICAgY29uc3Qgc2RrID0gdGhpcy5fbWFrZVNkayhiYXNlQ3JlZHMuY3JlZGVudGlhbHMsIGVudi5yZWdpb24pO1xuICAgICAgYXdhaXQgc2RrLnZhbGlkYXRlQ3JlZGVudGlhbHMoKTtcbiAgICAgIHJldHVybiB7IHNkaywgZGlkQXNzdW1lUm9sZTogZmFsc2UgfTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gV2Ugd2lsbCBwcm9jZWVkIHRvIEFzc3VtZVJvbGUgdXNpbmcgd2hhdGV2ZXIgd2UndmUgYmVlbiBnaXZlbi5cbiAgICAgIGNvbnN0IHNkayA9IGF3YWl0IHRoaXMud2l0aEFzc3VtZWRSb2xlKFxuICAgICAgICBiYXNlQ3JlZHMsXG4gICAgICAgIG9wdGlvbnMuYXNzdW1lUm9sZUFybixcbiAgICAgICAgb3B0aW9ucy5hc3N1bWVSb2xlRXh0ZXJuYWxJZCxcbiAgICAgICAgb3B0aW9ucy5hc3N1bWVSb2xlQWRkaXRpb25hbE9wdGlvbnMsXG4gICAgICAgIGVudi5yZWdpb24sXG4gICAgICApO1xuXG4gICAgICByZXR1cm4geyBzZGssIGRpZEFzc3VtZVJvbGU6IHRydWUgfTtcbiAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgaWYgKGVyci5uYW1lID09PSAnRXhwaXJlZFRva2VuJykge1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9XG5cbiAgICAgIC8vIEFzc3VtZVJvbGUgZmFpbGVkLiBQcm9jZWVkIGFuZCB3YXJuICppZiBhbmQgb25seSBpZiogdGhlIGJhc2VDcmVkZW50aWFscyB3ZXJlIGFscmVhZHkgZm9yIHRoZSByaWdodCBhY2NvdW50XG4gICAgICAvLyBvciByZXR1cm5lZCBmcm9tIGEgcGx1Z2luLiBUaGlzIGlzIHRvIGNvdmVyIHNvbWUgY3VycmVudCBzZXR1cHMgZm9yIHBlb3BsZSB1c2luZyBwbHVnaW5zIG9yIHByZWZlcnJpbmcgdG9cbiAgICAgIC8vIGZlZWQgdGhlIENMSSBjcmVkZW50aWFscyB3aGljaCBhcmUgc3VmZmljaWVudCBieSB0aGVtc2VsdmVzLiBQcmVmZXIgdG8gYXNzdW1lIHRoZSBjb3JyZWN0IHJvbGUgaWYgd2UgY2FuLFxuICAgICAgLy8gYnV0IGlmIHdlIGNhbid0IHRoZW4gbGV0J3MganVzdCB0cnkgd2l0aCBhdmFpbGFibGUgY3JlZGVudGlhbHMgYW55d2F5LlxuICAgICAgaWYgKGJhc2VDcmVkcy5zb3VyY2UgPT09ICdjb3JyZWN0RGVmYXVsdCcgfHwgYmFzZUNyZWRzLnNvdXJjZSA9PT0gJ3BsdWdpbicpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9TREtfREVCVUcubXNnKGVyci5tZXNzYWdlKSk7XG5cbiAgICAgICAgY29uc3QgbWFrZXIgPSBxdWlldCA/IElPLkRFRkFVTFRfU0RLX0RFQlVHIDogSU8uREVGQVVMVF9TREtfV0FSTjtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkobWFrZXIubXNnKFxuICAgICAgICAgIGAke2ZtdE9idGFpbmVkQ3JlZGVudGlhbHMoYmFzZUNyZWRzKX0gY291bGQgbm90IGJlIHVzZWQgdG8gYXNzdW1lICcke29wdGlvbnMuYXNzdW1lUm9sZUFybn0nLCBidXQgYXJlIGZvciB0aGUgcmlnaHQgYWNjb3VudC4gUHJvY2VlZGluZyBhbnl3YXkuYCxcbiAgICAgICAgKSk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc2RrOiB0aGlzLl9tYWtlU2RrKGJhc2VDcmVkcy5jcmVkZW50aWFscywgZW52LnJlZ2lvbiksXG4gICAgICAgICAgZGlkQXNzdW1lUm9sZTogZmFsc2UsXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIHRoZSBwYXJ0aXRpb24gdGhhdCBiYXNlIGNyZWRlbnRpYWxzIGFyZSBmb3JcbiAgICpcbiAgICogUmV0dXJucyBgdW5kZWZpbmVkYCBpZiB0aGVyZSBhcmUgbm8gYmFzZSBjcmVkZW50aWFscy5cbiAgICovXG4gIHB1YmxpYyBhc3luYyBiYXNlQ3JlZGVudGlhbHNQYXJ0aXRpb24oZW52aXJvbm1lbnQ6IEVudmlyb25tZW50LCBtb2RlOiBNb2RlKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCBlbnYgPSBhd2FpdCB0aGlzLnJlc29sdmVFbnZpcm9ubWVudChlbnZpcm9ubWVudCk7XG4gICAgY29uc3QgYmFzZUNyZWRzID0gYXdhaXQgdGhpcy5vYnRhaW5CYXNlQ3JlZGVudGlhbHMoZW52LmFjY291bnQsIG1vZGUpO1xuICAgIGlmIChiYXNlQ3JlZHMuc291cmNlID09PSAnbm9uZScpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHJldHVybiAoYXdhaXQgdGhpcy5fbWFrZVNkayhiYXNlQ3JlZHMuY3JlZGVudGlhbHMsIGVudi5yZWdpb24pLmN1cnJlbnRBY2NvdW50KCkpLnBhcnRpdGlvbjtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlIHRoZSBlbnZpcm9ubWVudCBmb3IgYSBzdGFja1xuICAgKlxuICAgKiBSZXBsYWNlcyB0aGUgbWFnaWMgdmFsdWVzIGBVTktOT1dOX1JFR0lPTmAgYW5kIGBVTktOT1dOX0FDQ09VTlRgXG4gICAqIHdpdGggdGhlIGRlZmF1bHRzIGZvciB0aGUgY3VycmVudCBTREsgY29uZmlndXJhdGlvbiAoYH4vLmF3cy9jb25maWdgIG9yXG4gICAqIG90aGVyd2lzZSkuXG4gICAqXG4gICAqIEl0IGlzIGFuIGVycm9yIGlmIGBVTktOT1dOX0FDQ09VTlRgIGlzIHVzZWQgYnV0IHRoZSB1c2VyIGhhc24ndCBjb25maWd1cmVkXG4gICAqIGFueSBTREsgY3JlZGVudGlhbHMuXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgcmVzb2x2ZUVudmlyb25tZW50KGVudjogRW52aXJvbm1lbnQpOiBQcm9taXNlPEVudmlyb25tZW50PiB7XG4gICAgY29uc3QgcmVnaW9uID0gZW52LnJlZ2lvbiAhPT0gVU5LTk9XTl9SRUdJT04gPyBlbnYucmVnaW9uIDogdGhpcy5kZWZhdWx0UmVnaW9uO1xuICAgIGNvbnN0IGFjY291bnQgPSBlbnYuYWNjb3VudCAhPT0gVU5LTk9XTl9BQ0NPVU5UID8gZW52LmFjY291bnQgOiAoYXdhaXQgdGhpcy5kZWZhdWx0QWNjb3VudCgpKT8uYWNjb3VudElkO1xuXG4gICAgaWYgKCFhY2NvdW50KSB7XG4gICAgICB0aHJvdyBuZXcgQXV0aGVudGljYXRpb25FcnJvcihcbiAgICAgICAgJ1VuYWJsZSB0byByZXNvbHZlIEFXUyBhY2NvdW50IHRvIHVzZS4gSXQgbXVzdCBiZSBlaXRoZXIgY29uZmlndXJlZCB3aGVuIHlvdSBkZWZpbmUgeW91ciBDREsgU3RhY2ssIG9yIHRocm91Z2ggdGhlIGVudmlyb25tZW50JyxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHJlZ2lvbixcbiAgICAgIGFjY291bnQsXG4gICAgICBuYW1lOiBFbnZpcm9ubWVudFV0aWxzLmZvcm1hdChhY2NvdW50LCByZWdpb24pLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogVGhlIGFjY291bnQgd2UnZCBhdXRoIGludG8gaWYgd2UgdXNlZCBkZWZhdWx0IGNyZWRlbnRpYWxzLlxuICAgKlxuICAgKiBEZWZhdWx0IGNyZWRlbnRpYWxzIGFyZSB0aGUgc2V0IG9mIGFtYmllbnRseSBjb25maWd1cmVkIGNyZWRlbnRpYWxzIHVzaW5nXG4gICAqIG9uZSBvZiB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGVzLCBvciB+Ly5hd3MvY3JlZGVudGlhbHMsIG9yIHRoZSAqb25lKlxuICAgKiBwcm9maWxlIHRoYXQgd2FzIHBhc3NlZCBpbnRvIHRoZSBDTEkuXG4gICAqXG4gICAqIE1pZ2h0IHJldHVybiB1bmRlZmluZWQgaWYgdGhlcmUgYXJlIG5vIGRlZmF1bHQvYW1iaWVudCBjcmVkZW50aWFsc1xuICAgKiBhdmFpbGFibGUgKGluIHdoaWNoIGNhc2UgdGhlIHVzZXIgc2hvdWxkIGJldHRlciBob3BlIHRoZXkgaGF2ZVxuICAgKiBjcmVkZW50aWFsIHBsdWdpbnMgY29uZmlndXJlZCkuXG4gICAqXG4gICAqIFVzZXMgYSBjYWNoZSB0byBhdm9pZCBTVFMgY2FsbHMgaWYgd2UgZG9uJ3QgbmVlZCAnZW0uXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgZGVmYXVsdEFjY291bnQoKTogUHJvbWlzZTxBY2NvdW50IHwgdW5kZWZpbmVkPiB7XG4gICAgcmV0dXJuIGNhY2hlZCh0aGlzLCBDQUNIRURfQUNDT1VOVCwgYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX21ha2VTZGsodGhpcy5kZWZhdWx0Q3JlZGVudGlhbFByb3ZpZGVyLCB0aGlzLmRlZmF1bHRSZWdpb24pLmN1cnJlbnRBY2NvdW50KCk7XG4gICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgLy8gVHJlYXQgJ0V4cGlyZWRUb2tlbicgc3BlY2lhbGx5LiBUaGlzIGlzIGEgY29tbW9uIHNpdHVhdGlvbiB0aGF0IHBlb3BsZSBtYXkgZmluZCB0aGVtc2VsdmVzIGluLCBhbmRcbiAgICAgICAgLy8gdGhleSBhcmUgY29tcGxhaW5pbmcgYWJvdXQgaWYgd2UgZmFpbCAnY2RrIHN5bnRoJyBvbiB0aGVtLiBXZSBsb3VkbHkgY29tcGxhaW4gaW4gb3JkZXIgdG8gc2hvdyB0aGF0XG4gICAgICAgIC8vIHRoZSBjdXJyZW50IHNpdHVhdGlvbiBpcyBwcm9iYWJseSB1bmRlc2lyYWJsZSwgYnV0IHdlIGRvbid0IGZhaWwuXG4gICAgICAgIGlmIChlLm5hbWUgPT09ICdFeHBpcmVkVG9rZW4nKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9TREtfV0FSTi5tc2coXG4gICAgICAgICAgICAnVGhlcmUgYXJlIGV4cGlyZWQgQVdTIGNyZWRlbnRpYWxzIGluIHlvdXIgZW52aXJvbm1lbnQuIFRoZSBDREsgYXBwIHdpbGwgc3ludGggd2l0aG91dCBjdXJyZW50IGFjY291bnQgaW5mb3JtYXRpb24uJyxcbiAgICAgICAgICApKTtcbiAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9TREtfREVCVUcubXNnKGBVbmFibGUgdG8gZGV0ZXJtaW5lIHRoZSBkZWZhdWx0IEFXUyBhY2NvdW50ICgke2UubmFtZX0pOiAke2Zvcm1hdEVycm9yTWVzc2FnZShlKX1gKSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGNyZWRlbnRpYWxzIGZvciB0aGUgZ2l2ZW4gYWNjb3VudCBJRCBpbiB0aGUgZ2l2ZW4gbW9kZVxuICAgKlxuICAgKiAxLiBVc2UgdGhlIGRlZmF1bHQgY3JlZGVudGlhbHMgaWYgdGhlIGRlc3RpbmF0aW9uIGFjY291bnQgbWF0Y2hlcyB0aGVcbiAgICogICAgY3VycmVudCBjcmVkZW50aWFscycgYWNjb3VudC5cbiAgICogMi4gT3RoZXJ3aXNlIHRyeSBhbGwgY3JlZGVudGlhbCBwbHVnaW5zLlxuICAgKiAzLiBGYWlsIGlmIG5laXRoZXIgb2YgdGhlc2UgeWllbGQgYW55IGNyZWRlbnRpYWxzLlxuICAgKiA0LiBSZXR1cm4gYSBmYWlsdXJlIGlmIGFueSBvZiB0aGVtIHJldHVybmVkIGNyZWRlbnRpYWxzXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIG9idGFpbkJhc2VDcmVkZW50aWFscyhhY2NvdW50SWQ6IHN0cmluZywgbW9kZTogTW9kZSk6IFByb21pc2U8T2J0YWluQmFzZUNyZWRlbnRpYWxzUmVzdWx0PiB7XG4gICAgLy8gRmlyc3QgdHJ5ICdjdXJyZW50JyBjcmVkZW50aWFsc1xuICAgIGNvbnN0IGRlZmF1bHRBY2NvdW50SWQgPSAoYXdhaXQgdGhpcy5kZWZhdWx0QWNjb3VudCgpKT8uYWNjb3VudElkO1xuICAgIGlmIChkZWZhdWx0QWNjb3VudElkID09PSBhY2NvdW50SWQpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHNvdXJjZTogJ2NvcnJlY3REZWZhdWx0JyxcbiAgICAgICAgY3JlZGVudGlhbHM6IGF3YWl0IHRoaXMuZGVmYXVsdENyZWRlbnRpYWxQcm92aWRlcixcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVGhlbiB0cnkgdGhlIHBsdWdpbnNcbiAgICBjb25zdCBwbHVnaW5DcmVkcyA9IGF3YWl0IHRoaXMucGx1Z2lucy5mZXRjaENyZWRlbnRpYWxzRm9yKGFjY291bnRJZCwgbW9kZSk7XG4gICAgaWYgKHBsdWdpbkNyZWRzKSB7XG4gICAgICByZXR1cm4geyBzb3VyY2U6ICdwbHVnaW4nLCAuLi5wbHVnaW5DcmVkcyB9O1xuICAgIH1cblxuICAgIC8vIEZhbGwgYmFjayB0byBkZWZhdWx0IGNyZWRlbnRpYWxzIHdpdGggYSBub3RlIHRoYXQgdGhleSdyZSBub3QgdGhlIHJpZ2h0IG9uZXMgeWV0XG4gICAgaWYgKGRlZmF1bHRBY2NvdW50SWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc291cmNlOiAnaW5jb3JyZWN0RGVmYXVsdCcsXG4gICAgICAgIGFjY291bnRJZDogZGVmYXVsdEFjY291bnRJZCxcbiAgICAgICAgY3JlZGVudGlhbHM6IGF3YWl0IHRoaXMuZGVmYXVsdENyZWRlbnRpYWxQcm92aWRlcixcbiAgICAgICAgdW51c2VkUGx1Z2luczogdGhpcy5wbHVnaW5zLmF2YWlsYWJsZVBsdWdpbk5hbWVzLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBBcHBhcmVudGx5IHdlIGRpZG4ndCBmaW5kIGFueSBhdCBhbGxcbiAgICByZXR1cm4ge1xuICAgICAgc291cmNlOiAnbm9uZScsXG4gICAgICB1bnVzZWRQbHVnaW5zOiB0aGlzLnBsdWdpbnMuYXZhaWxhYmxlUGx1Z2luTmFtZXMsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gYW4gU0RLIHdoaWNoIHVzZXMgYXNzdW1lZCByb2xlIGNyZWRlbnRpYWxzXG4gICAqXG4gICAqIFRoZSBiYXNlIGNyZWRlbnRpYWxzIHVzZWQgdG8gcmV0cmlldmUgdGhlIGFzc3VtZWQgcm9sZSBjcmVkZW50aWFscyB3aWxsIGJlIHRoZVxuICAgKiBzYW1lIGNyZWRlbnRpYWxzIHJldHVybmVkIGJ5IG9idGFpbkNyZWRlbnRpYWxzIGlmIGFuIGVudmlyb25tZW50IGFuZCBtb2RlIGlzIHBhc3NlZCxcbiAgICogb3RoZXJ3aXNlIGl0IHdpbGwgYmUgdGhlIGN1cnJlbnQgY3JlZGVudGlhbHMuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHdpdGhBc3N1bWVkUm9sZShcbiAgICBtYWluQ3JlZGVudGlhbHM6IEV4Y2x1ZGU8T2J0YWluQmFzZUNyZWRlbnRpYWxzUmVzdWx0LCB7IHNvdXJjZTogJ25vbmUnIH0+LFxuICAgIHJvbGVBcm46IHN0cmluZyxcbiAgICBleHRlcm5hbElkPzogc3RyaW5nLFxuICAgIGFkZGl0aW9uYWxPcHRpb25zPzogQXNzdW1lUm9sZUFkZGl0aW9uYWxPcHRpb25zLFxuICAgIHJlZ2lvbj86IHN0cmluZyxcbiAgKTogUHJvbWlzZTxTREs+IHtcbiAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1NES19ERUJVRy5tc2coYEFzc3VtaW5nIHJvbGUgJyR7cm9sZUFybn0nLmApKTtcblxuICAgIHJlZ2lvbiA9IHJlZ2lvbiA/PyB0aGlzLmRlZmF1bHRSZWdpb247XG5cbiAgICBjb25zdCBzb3VyY2VEZXNjcmlwdGlvbiA9IGZtdE9idGFpbmVkQ3JlZGVudGlhbHMobWFpbkNyZWRlbnRpYWxzKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjcmVkZW50aWFscyA9IGF3YWl0IG1ha2VDYWNoaW5nUHJvdmlkZXIoZnJvbVRlbXBvcmFyeUNyZWRlbnRpYWxzKHtcbiAgICAgICAgbWFzdGVyQ3JlZGVudGlhbHM6IG1haW5DcmVkZW50aWFscy5jcmVkZW50aWFscyxcbiAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgUm9sZUFybjogcm9sZUFybixcbiAgICAgICAgICBFeHRlcm5hbElkOiBleHRlcm5hbElkLFxuICAgICAgICAgIFJvbGVTZXNzaW9uTmFtZTogYGF3cy1jZGstJHtzYWZlVXNlcm5hbWUoKX1gLFxuICAgICAgICAgIC4uLmFkZGl0aW9uYWxPcHRpb25zLFxuICAgICAgICAgIFRyYW5zaXRpdmVUYWdLZXlzOiBhZGRpdGlvbmFsT3B0aW9ucz8uVGFncyA/IGFkZGl0aW9uYWxPcHRpb25zLlRhZ3MubWFwKCh0KSA9PiB0LktleSEpIDogdW5kZWZpbmVkLFxuICAgICAgICB9LFxuICAgICAgICBjbGllbnRDb25maWc6IHtcbiAgICAgICAgICByZWdpb24sXG4gICAgICAgICAgcmVxdWVzdEhhbmRsZXI6IHRoaXMucmVxdWVzdEhhbmRsZXIsXG4gICAgICAgICAgY3VzdG9tVXNlckFnZW50OiAnYXdzLWNkaycsXG4gICAgICAgICAgbG9nZ2VyOiB0aGlzLmxvZ2dlcixcbiAgICAgICAgfSxcbiAgICAgICAgbG9nZ2VyOiB0aGlzLmxvZ2dlcixcbiAgICAgIH0pKTtcblxuICAgICAgLy8gQ2FsbCB0aGUgcHJvdmlkZXIgYXQgbGVhc3Qgb25jZSBoZXJlLCB0byBjYXRjaCBhbiBlcnJvciBpZiBpdCBvY2N1cnNcbiAgICAgIGF3YWl0IGNyZWRlbnRpYWxzKCk7XG5cbiAgICAgIHJldHVybiB0aGlzLl9tYWtlU2RrKGNyZWRlbnRpYWxzLCByZWdpb24pO1xuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICBpZiAoZXJyLm5hbWUgPT09ICdFeHBpcmVkVG9rZW4nKSB7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9TREtfREVCVUcubXNnKGBBc3N1bWluZyByb2xlIGZhaWxlZDogJHtlcnIubWVzc2FnZX1gKSk7XG4gICAgICB0aHJvdyBuZXcgQXV0aGVudGljYXRpb25FcnJvcihcbiAgICAgICAgW1xuICAgICAgICAgICdDb3VsZCBub3QgYXNzdW1lIHJvbGUgaW4gdGFyZ2V0IGFjY291bnQnLFxuICAgICAgICAgIC4uLihzb3VyY2VEZXNjcmlwdGlvbiA/IFtgdXNpbmcgJHtzb3VyY2VEZXNjcmlwdGlvbn1gXSA6IFtdKSxcbiAgICAgICAgICBlcnIubWVzc2FnZSxcbiAgICAgICAgICBcIi4gUGxlYXNlIG1ha2Ugc3VyZSB0aGF0IHRoaXMgcm9sZSBleGlzdHMgaW4gdGhlIGFjY291bnQuIElmIGl0IGRvZXNuJ3QgZXhpc3QsIChyZSktYm9vdHN0cmFwIHRoZSBlbnZpcm9ubWVudCBcIiArXG4gICAgICAgICAgICBcIndpdGggdGhlIHJpZ2h0ICctLXRydXN0JywgdXNpbmcgdGhlIGxhdGVzdCB2ZXJzaW9uIG9mIHRoZSBDREsgQ0xJLlwiLFxuICAgICAgICBdLmpvaW4oJyAnKSxcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZhY3RvcnkgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEgbmV3IFNESyBpbnN0YW5jZVxuICAgKlxuICAgKiBUaGlzIGlzIGEgZnVuY3Rpb24gaGVyZSwgaW5zdGVhZCBvZiBhbGwgdGhlIHBsYWNlcyB3aGVyZSB0aGlzIGlzIHVzZWQgY3JlYXRpbmcgYSBgbmV3IFNES2BcbiAgICogaW5zdGFuY2UsIHNvIHRoYXQgaXQgaXMgdHJpdmlhbCB0byBtb2NrIGZyb20gdGVzdHMuXG4gICAqXG4gICAqIFVzZSBsaWtlIHRoaXM6XG4gICAqXG4gICAqIGBgYHRzXG4gICAqIGNvbnN0IG1vY2tTZGsgPSBqZXN0LnNweU9uKFNka1Byb3ZpZGVyLnByb3RvdHlwZSwgJ19tYWtlU2RrJykubW9ja1JldHVyblZhbHVlKG5ldyBNb2NrU2RrKCkpO1xuICAgKiAvLyAuLi5cbiAgICogbW9ja1Nkay5tb2NrUmVzdG9yZSgpO1xuICAgKiBgYGBcbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBwdWJsaWMgX21ha2VTZGsoXG4gICAgY3JlZFByb3ZpZGVyOiBBd3NDcmVkZW50aWFsSWRlbnRpdHlQcm92aWRlcixcbiAgICByZWdpb246IHN0cmluZyxcbiAgKSB7XG4gICAgcmV0dXJuIG5ldyBTREsoY3JlZFByb3ZpZGVyLCByZWdpb24sIHRoaXMucmVxdWVzdEhhbmRsZXIsIHRoaXMuaW9IZWxwZXIsIHRoaXMubG9nZ2VyKTtcbiAgfVxufVxuXG4vKipcbiAqIEFuIEFXUyBhY2NvdW50XG4gKlxuICogQW4gQVdTIGFjY291bnQgYWx3YXlzIGV4aXN0cyBpbiBvbmx5IG9uZSBwYXJ0aXRpb24uIFVzdWFsbHkgd2UgZG9uJ3QgY2FyZSBhYm91dFxuICogdGhlIHBhcnRpdGlvbiwgYnV0IHdoZW4gd2UgbmVlZCB0byBmb3JtIEFSTnMgd2UgZG8uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQWNjb3VudCB7XG4gIC8qKlxuICAgKiBUaGUgYWNjb3VudCBudW1iZXJcbiAgICovXG4gIHJlYWRvbmx5IGFjY291bnRJZDogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgcGFydGl0aW9uICgnYXdzJyBvciAnYXdzLWNuJyBvciBvdGhlcndpc2UpXG4gICAqL1xuICByZWFkb25seSBwYXJ0aXRpb246IHN0cmluZztcbn1cblxuLyoqXG4gKiBSZXR1cm4gdGhlIHVzZXJuYW1lIHdpdGggY2hhcmFjdGVycyBpbnZhbGlkIGZvciBhIFJvbGVTZXNzaW9uTmFtZSByZW1vdmVkXG4gKlxuICogQHNlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vU1RTL2xhdGVzdC9BUElSZWZlcmVuY2UvQVBJX0Fzc3VtZVJvbGUuaHRtbCNBUElfQXNzdW1lUm9sZV9SZXF1ZXN0UGFyYW1ldGVyc1xuICovXG5mdW5jdGlvbiBzYWZlVXNlcm5hbWUoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIG9zLnVzZXJJbmZvKCkudXNlcm5hbWUucmVwbGFjZSgvW15cXHcrPSwuQC1dL2csICdAJyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnbm9uYW1lJztcbiAgfVxufVxuXG4vKipcbiAqIE9wdGlvbnMgZm9yIG9idGFpbmluZyBjcmVkZW50aWFscyBmb3IgYW4gZW52aXJvbm1lbnRcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDcmVkZW50aWFsc09wdGlvbnMge1xuICAvKipcbiAgICogVGhlIEFSTiBvZiB0aGUgcm9sZSB0aGF0IG5lZWRzIHRvIGJlIGFzc3VtZWQsIGlmIGFueVxuICAgKi9cbiAgcmVhZG9ubHkgYXNzdW1lUm9sZUFybj86IHN0cmluZztcblxuICAvKipcbiAgICogRXh0ZXJuYWwgSUQgcmVxdWlyZWQgdG8gYXNzdW1lIHRoZSBnaXZlbiByb2xlLlxuICAgKi9cbiAgcmVhZG9ubHkgYXNzdW1lUm9sZUV4dGVybmFsSWQ/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFNlc3Npb24gdGFncyByZXF1aXJlZCB0byBhc3N1bWUgdGhlIGdpdmVuIHJvbGUuXG4gICAqL1xuICByZWFkb25seSBhc3N1bWVSb2xlQWRkaXRpb25hbE9wdGlvbnM/OiBBc3N1bWVSb2xlQWRkaXRpb25hbE9wdGlvbnM7XG59XG5cbi8qKlxuICogUmVzdWx0IG9mIG9idGFpbmluZyBiYXNlIGNyZWRlbnRpYWxzXG4gKi9cbnR5cGUgT2J0YWluQmFzZUNyZWRlbnRpYWxzUmVzdWx0ID1cbiAgfCB7IHNvdXJjZTogJ2NvcnJlY3REZWZhdWx0JzsgY3JlZGVudGlhbHM6IEF3c0NyZWRlbnRpYWxJZGVudGl0eVByb3ZpZGVyIH1cbiAgfCB7IHNvdXJjZTogJ3BsdWdpbic7IHBsdWdpbk5hbWU6IHN0cmluZzsgY3JlZGVudGlhbHM6IEF3c0NyZWRlbnRpYWxJZGVudGl0eVByb3ZpZGVyIH1cbiAgfCB7XG4gICAgc291cmNlOiAnaW5jb3JyZWN0RGVmYXVsdCc7XG4gICAgY3JlZGVudGlhbHM6IEF3c0NyZWRlbnRpYWxJZGVudGl0eVByb3ZpZGVyO1xuICAgIGFjY291bnRJZDogc3RyaW5nO1xuICAgIHVudXNlZFBsdWdpbnM6IHN0cmluZ1tdO1xuICB9XG4gIHwgeyBzb3VyY2U6ICdub25lJzsgdW51c2VkUGx1Z2luczogc3RyaW5nW10gfTtcblxuLyoqXG4gKiBJc29sYXRpbmcgdGhlIGNvZGUgdGhhdCB0cmFuc2xhdGVzIGNhbGN1bGF0aW9uIGVycm9ycyBpbnRvIGh1bWFuIGVycm9yIG1lc3NhZ2VzXG4gKlxuICogV2UgY292ZXIgdGhlIGZvbGxvd2luZyBjYXNlczpcbiAqXG4gKiAtIE5vIGNyZWRlbnRpYWxzIGFyZSBhdmFpbGFibGUgYXQgYWxsXG4gKiAtIERlZmF1bHQgY3JlZGVudGlhbHMgYXJlIGZvciB0aGUgd3JvbmcgYWNjb3VudFxuICovXG5mdW5jdGlvbiBmbXRPYnRhaW5DcmVkZW50aWFsc0Vycm9yKFxuICB0YXJnZXRBY2NvdW50SWQ6IHN0cmluZyxcbiAgb2J0YWluUmVzdWx0OiBPYnRhaW5CYXNlQ3JlZGVudGlhbHNSZXN1bHQgJiB7XG4gICAgc291cmNlOiAnbm9uZScgfCAnaW5jb3JyZWN0RGVmYXVsdCc7XG4gIH0sXG4pOiBzdHJpbmcge1xuICBjb25zdCBtc2cgPSBbYE5lZWQgdG8gcGVyZm9ybSBBV1MgY2FsbHMgZm9yIGFjY291bnQgJHt0YXJnZXRBY2NvdW50SWR9YF07XG4gIHN3aXRjaCAob2J0YWluUmVzdWx0LnNvdXJjZSkge1xuICAgIGNhc2UgJ2luY29ycmVjdERlZmF1bHQnOlxuICAgICAgbXNnLnB1c2goYGJ1dCB0aGUgY3VycmVudCBjcmVkZW50aWFscyBhcmUgZm9yICR7b2J0YWluUmVzdWx0LmFjY291bnRJZH1gKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ25vbmUnOlxuICAgICAgbXNnLnB1c2goJ2J1dCBubyBjcmVkZW50aWFscyBoYXZlIGJlZW4gY29uZmlndXJlZCcpO1xuICB9XG4gIGlmIChvYnRhaW5SZXN1bHQudW51c2VkUGx1Z2lucy5sZW5ndGggPiAwKSB7XG4gICAgbXNnLnB1c2goYGFuZCBub25lIG9mIHRoZXNlIHBsdWdpbnMgZm91bmQgYW55OiAke29idGFpblJlc3VsdC51bnVzZWRQbHVnaW5zLmpvaW4oJywgJyl9YCk7XG4gIH1cbiAgcmV0dXJuIG1zZy5qb2luKCcsICcpO1xufVxuXG4vKipcbiAqIEZvcm1hdCBhIG1lc3NhZ2UgaW5kaWNhdGluZyB3aGVyZSB3ZSBnb3QgYmFzZSBjcmVkZW50aWFscyBmb3IgdGhlIGFzc3VtZSByb2xlXG4gKlxuICogV2UgY292ZXIgdGhlIGZvbGxvd2luZyBjYXNlczpcbiAqXG4gKiAtIERlZmF1bHQgY3JlZGVudGlhbHMgZm9yIHRoZSByaWdodCBhY2NvdW50XG4gKiAtIERlZmF1bHQgY3JlZGVudGlhbHMgZm9yIHRoZSB3cm9uZyBhY2NvdW50XG4gKiAtIENyZWRlbnRpYWxzIHJldHVybmVkIGZyb20gYSBwbHVnaW5cbiAqL1xuZnVuY3Rpb24gZm10T2J0YWluZWRDcmVkZW50aWFscyhvYnRhaW5SZXN1bHQ6IEV4Y2x1ZGU8T2J0YWluQmFzZUNyZWRlbnRpYWxzUmVzdWx0LCB7IHNvdXJjZTogJ25vbmUnIH0+KTogc3RyaW5nIHtcbiAgc3dpdGNoIChvYnRhaW5SZXN1bHQuc291cmNlKSB7XG4gICAgY2FzZSAnY29ycmVjdERlZmF1bHQnOlxuICAgICAgcmV0dXJuICdjdXJyZW50IGNyZWRlbnRpYWxzJztcbiAgICBjYXNlICdwbHVnaW4nOlxuICAgICAgcmV0dXJuIGBjcmVkZW50aWFscyByZXR1cm5lZCBieSBwbHVnaW4gJyR7b2J0YWluUmVzdWx0LnBsdWdpbk5hbWV9J2A7XG4gICAgY2FzZSAnaW5jb3JyZWN0RGVmYXVsdCc6XG4gICAgICBjb25zdCBtc2cgPSBbXTtcbiAgICAgIG1zZy5wdXNoKGBjdXJyZW50IGNyZWRlbnRpYWxzICh3aGljaCBhcmUgZm9yIGFjY291bnQgJHtvYnRhaW5SZXN1bHQuYWNjb3VudElkfWApO1xuXG4gICAgICBpZiAob2J0YWluUmVzdWx0LnVudXNlZFBsdWdpbnMubGVuZ3RoID4gMCkge1xuICAgICAgICBtc2cucHVzaChgLCBhbmQgbm9uZSBvZiB0aGUgZm9sbG93aW5nIHBsdWdpbnMgcHJvdmlkZWQgY3JlZGVudGlhbHM6ICR7b2J0YWluUmVzdWx0LnVudXNlZFBsdWdpbnMuam9pbignLCAnKX1gKTtcbiAgICAgIH1cbiAgICAgIG1zZy5wdXNoKCcpJyk7XG5cbiAgICAgIHJldHVybiBtc2cuam9pbignJyk7XG4gIH1cbn1cblxuLyoqXG4gKiBJbnN0YW50aWF0ZSBhbiBTREsgZm9yIGNvbnRleHQgcHJvdmlkZXJzLiBUaGlzIGZ1bmN0aW9uIGVuc3VyZXMgdGhhdCBhbGxcbiAqIGxvb2t1cCBhc3N1bWUgcm9sZSBvcHRpb25zIGFyZSB1c2VkIHdoZW4gY29udGV4dCBwcm92aWRlcnMgcGVyZm9ybSBsb29rdXBzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaW5pdENvbnRleHRQcm92aWRlclNkayhhd3M6IFNka1Byb3ZpZGVyLCBvcHRpb25zOiBDb250ZXh0TG9va3VwUm9sZU9wdGlvbnMpOiBQcm9taXNlPFNESz4ge1xuICBjb25zdCBhY2NvdW50ID0gb3B0aW9ucy5hY2NvdW50O1xuICBjb25zdCByZWdpb24gPSBvcHRpb25zLnJlZ2lvbjtcblxuICBjb25zdCBjcmVkczogQ3JlZGVudGlhbHNPcHRpb25zID0ge1xuICAgIGFzc3VtZVJvbGVBcm46IG9wdGlvbnMubG9va3VwUm9sZUFybixcbiAgICBhc3N1bWVSb2xlRXh0ZXJuYWxJZDogb3B0aW9ucy5sb29rdXBSb2xlRXh0ZXJuYWxJZCxcbiAgICBhc3N1bWVSb2xlQWRkaXRpb25hbE9wdGlvbnM6IG9wdGlvbnMuYXNzdW1lUm9sZUFkZGl0aW9uYWxPcHRpb25zLFxuICB9O1xuXG4gIHJldHVybiAoYXdhaXQgYXdzLmZvckVudmlyb25tZW50KEVudmlyb25tZW50VXRpbHMubWFrZShhY2NvdW50LCByZWdpb24pLCBNb2RlLkZvclJlYWRpbmcsIGNyZWRzKSkuc2RrO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNka1Byb3ZpZGVyU2VydmljZXMge1xuICAvKipcbiAgICogQW4gSU8gaGVscGVyIGZvciBlbWl0dGluZyBtZXNzYWdlc1xuICAgKi9cbiAgcmVhZG9ubHkgaW9IZWxwZXI6IElvSGVscGVyO1xuXG4gIC8qKlxuICAgKiBUaGUgcmVxdWVzdCBoYW5kbGVyIHNldHRpbmdzXG4gICAqL1xuICByZWFkb25seSByZXF1ZXN0SGFuZGxlcj86IE5vZGVIdHRwSGFuZGxlck9wdGlvbnM7XG5cbiAgLyoqXG4gICAqIEEgcGx1Z2luIGhvc3RcbiAgICovXG4gIHJlYWRvbmx5IHBsdWdpbkhvc3Q/OiBQbHVnaW5Ib3N0O1xuXG4gIC8qKlxuICAgKiBBbiBTREsgbG9nZ2VyXG4gICAqL1xuICByZWFkb25seSBsb2dnZXI/OiBMb2dnZXI7XG59XG4iXX0=