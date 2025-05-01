"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AwsCliCompatible = void 0;
exports.makeRequestHandler = makeRequestHandler;
const node_util_1 = require("node:util");
const credential_providers_1 = require("@aws-sdk/credential-providers");
const ec2_metadata_service_1 = require("@aws-sdk/ec2-metadata-service");
const shared_ini_file_loader_1 = require("@smithy/shared-ini-file-loader");
const promptly = require("promptly");
const provider_caching_1 = require("./provider-caching");
const proxy_agent_1 = require("./proxy-agent");
const private_1 = require("../io/private");
const toolkit_error_1 = require("../toolkit-error");
const DEFAULT_CONNECTION_TIMEOUT = 10000;
const DEFAULT_TIMEOUT = 300000;
/**
 * Behaviors to match AWS CLI
 *
 * See these links:
 *
 * https://docs.aws.amazon.com/cli/latest/topic/config-vars.html
 * https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html
 */
class AwsCliCompatible {
    ioHelper;
    requestHandler;
    logger;
    constructor(ioHelper, requestHandler, logger) {
        this.ioHelper = ioHelper;
        this.requestHandler = requestHandler;
        this.logger = logger;
    }
    async baseConfig(profile) {
        const credentialProvider = await this.credentialChainBuilder({
            profile,
            logger: this.logger,
        });
        const defaultRegion = await this.region(profile);
        return { credentialProvider, defaultRegion };
    }
    /**
     * Build an AWS CLI-compatible credential chain provider
     *
     * The credential chain returned by this function is always caching.
     */
    async credentialChainBuilder(options = {}) {
        const clientConfig = {
            requestHandler: this.requestHandler,
            customUserAgent: 'aws-cdk',
            logger: options.logger,
        };
        // Super hacky solution to https://github.com/aws/aws-cdk/issues/32510, proposed by the SDK team.
        //
        // Summary of the problem: we were reading the region from the config file and passing it to
        // the credential providers. However, in the case of SSO, this makes the credential provider
        // use that region to do the SSO flow, which is incorrect. The region that should be used for
        // that is the one set in the sso_session section of the config file.
        //
        // The idea here: the "clientConfig" is for configuring the inner auth client directly,
        // and has the highest priority, whereas "parentClientConfig" is the upper data client
        // and has lower priority than the sso_region but still higher priority than STS global region.
        const parentClientConfig = {
            region: await this.region(options.profile),
        };
        /**
         * The previous implementation matched AWS CLI behavior:
         *
         * If a profile is explicitly set using `--profile`,
         * we use that to the exclusion of everything else.
         *
         * Note: this does not apply to AWS_PROFILE,
         * environment credentials still take precedence over AWS_PROFILE
         */
        if (options.profile) {
            return (0, provider_caching_1.makeCachingProvider)((0, credential_providers_1.fromIni)({
                profile: options.profile,
                ignoreCache: true,
                mfaCodeProvider: this.tokenCodeFn.bind(this),
                clientConfig,
                parentClientConfig,
                logger: options.logger,
            }));
        }
        const envProfile = process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE;
        /**
         * Env AWS - EnvironmentCredentials with string AWS
         * Env Amazon - EnvironmentCredentials with string AMAZON
         * Profile Credentials - PatchedSharedIniFileCredentials with implicit profile, credentials file, http options, and token fn
         *    SSO with implicit profile only
         *    SharedIniFileCredentials with implicit profile and preferStaticCredentials true (profile with source_profile)
         *    Shared Credential file that points to Environment Credentials with AWS prefix
         *    Shared Credential file that points to EC2 Metadata
         *    Shared Credential file that points to ECS Credentials
         * SSO Credentials - SsoCredentials with implicit profile and http options
         * ProcessCredentials with implicit profile
         * ECS Credentials - ECSCredentials with no input OR Web Identity - TokenFileWebIdentityCredentials with no input OR EC2 Metadata - EC2MetadataCredentials with no input
         *
         * These translate to:
         * fromEnv()
         * fromSSO()/fromIni()
         * fromProcess()
         * fromContainerMetadata()
         * fromTokenFile()
         * fromInstanceMetadata()
         *
         * The NodeProviderChain is already cached.
         */
        const nodeProviderChain = (0, credential_providers_1.fromNodeProviderChain)({
            profile: envProfile,
            clientConfig,
            parentClientConfig,
            logger: options.logger,
            mfaCodeProvider: this.tokenCodeFn.bind(this),
            ignoreCache: true,
        });
        return shouldPrioritizeEnv()
            ? (0, credential_providers_1.createCredentialChain)((0, credential_providers_1.fromEnv)(), nodeProviderChain).expireAfter(60 * 60_000)
            : nodeProviderChain;
    }
    /**
     * Attempts to get the region from a number of sources and falls back to us-east-1 if no region can be found,
     * as is done in the AWS CLI.
     *
     * The order of priority is the following:
     *
     * 1. Environment variables specifying region, with both an AWS prefix and AMAZON prefix
     *    to maintain backwards compatibility, and without `DEFAULT` in the name because
     *    Lambda and CodeBuild set the $AWS_REGION variable.
     * 2. Regions listed in the Shared Ini Files - First checking for the profile provided
     *    and then checking for the default profile.
     * 3. IMDS instance identity region from the Metadata Service.
     * 4. us-east-1
     */
    async region(maybeProfile) {
        const defaultRegion = 'us-east-1';
        const profile = maybeProfile || process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE || 'default';
        const region = process.env.AWS_REGION ||
            process.env.AMAZON_REGION ||
            process.env.AWS_DEFAULT_REGION ||
            process.env.AMAZON_DEFAULT_REGION ||
            (await this.getRegionFromIni(profile)) ||
            (await this.regionFromMetadataService());
        if (!region) {
            const usedProfile = !profile ? '' : ` (profile: "${profile}")`;
            await this.ioHelper.notify(private_1.IO.DEFAULT_SDK_DEBUG.msg(`Unable to determine AWS region from environment or AWS configuration${usedProfile}, defaulting to '${defaultRegion}'`));
            return defaultRegion;
        }
        return region;
    }
    /**
     * The MetadataService class will attempt to fetch the instance identity document from
     * IMDSv2 first, and then will attempt v1 as a fallback.
     *
     * If this fails, we will use us-east-1 as the region so no error should be thrown.
     * @returns The region for the instance identity
     */
    async regionFromMetadataService() {
        await this.ioHelper.notify(private_1.IO.DEFAULT_SDK_DEBUG.msg('Looking up AWS region in the EC2 Instance Metadata Service (IMDS).'));
        try {
            const metadataService = new ec2_metadata_service_1.MetadataService({
                httpOptions: {
                    timeout: 1000,
                },
            });
            await metadataService.fetchMetadataToken();
            const document = await metadataService.request('/latest/dynamic/instance-identity/document', {});
            return JSON.parse(document).region;
        }
        catch (e) {
            await this.ioHelper.notify(private_1.IO.DEFAULT_SDK_DEBUG.msg(`Unable to retrieve AWS region from IMDS: ${e}`));
        }
    }
    /**
     * Looks up the region of the provided profile. If no region is present,
     * it will attempt to lookup the default region.
     * @param profile The profile to use to lookup the region
     * @returns The region for the profile or default profile, if present. Otherwise returns undefined.
     */
    async getRegionFromIni(profile) {
        const sharedFiles = await (0, shared_ini_file_loader_1.loadSharedConfigFiles)({ ignoreCache: true });
        // Priority:
        //
        // credentials come before config because aws-cli v1 behaves like that.
        //
        // 1. profile-region-in-credentials
        // 2. profile-region-in-config
        // 3. default-region-in-credentials
        // 4. default-region-in-config
        return this.getRegionFromIniFile(profile, sharedFiles.credentialsFile)
            ?? this.getRegionFromIniFile(profile, sharedFiles.configFile)
            ?? this.getRegionFromIniFile('default', sharedFiles.credentialsFile)
            ?? this.getRegionFromIniFile('default', sharedFiles.configFile);
    }
    getRegionFromIniFile(profile, data) {
        return data?.[profile]?.region;
    }
    /**
     * Ask user for MFA token for given serial
     *
     * Result is send to callback function for SDK to authorize the request
     */
    async tokenCodeFn(serialArn) {
        const debugFn = (msg, ...args) => this.ioHelper.notify(private_1.IO.DEFAULT_SDK_DEBUG.msg((0, node_util_1.format)(msg, ...args)));
        await debugFn('Require MFA token for serial ARN', serialArn);
        try {
            const token = await promptly.prompt(`MFA token for ${serialArn}: `, {
                trim: true,
                default: '',
            });
            await debugFn('Successfully got MFA token from user');
            return token;
        }
        catch (err) {
            await debugFn('Failed to get MFA token', err);
            const e = new toolkit_error_1.AuthenticationError(`Error fetching MFA token: ${err.message ?? err}`);
            e.name = 'SharedIniFileCredentialsProviderFailure';
            throw e;
        }
    }
}
exports.AwsCliCompatible = AwsCliCompatible;
/**
 * We used to support both AWS and AMAZON prefixes for these environment variables.
 *
 * Adding this for backward compatibility.
 */
function shouldPrioritizeEnv() {
    const id = process.env.AWS_ACCESS_KEY_ID || process.env.AMAZON_ACCESS_KEY_ID;
    const key = process.env.AWS_SECRET_ACCESS_KEY || process.env.AMAZON_SECRET_ACCESS_KEY;
    if (!!id && !!key) {
        process.env.AWS_ACCESS_KEY_ID = id;
        process.env.AWS_SECRET_ACCESS_KEY = key;
        const sessionToken = process.env.AWS_SESSION_TOKEN ?? process.env.AMAZON_SESSION_TOKEN;
        if (sessionToken) {
            process.env.AWS_SESSION_TOKEN = sessionToken;
        }
        return true;
    }
    return false;
}
async function makeRequestHandler(ioHelper, options = {}) {
    const agent = await new proxy_agent_1.ProxyAgentProvider(ioHelper).create(options);
    return {
        connectionTimeout: DEFAULT_CONNECTION_TIMEOUT,
        requestTimeout: DEFAULT_TIMEOUT,
        httpsAgent: agent,
        httpAgent: agent,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXdzY2xpLWNvbXBhdGlibGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXBpL2F3cy1hdXRoL2F3c2NsaS1jb21wYXRpYmxlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQWdSQSxnREFTQztBQXpSRCx5Q0FBbUM7QUFDbkMsd0VBQStHO0FBQy9HLHdFQUFnRTtBQUVoRSwyRUFBdUU7QUFFdkUscUNBQXFDO0FBQ3JDLHlEQUF5RDtBQUN6RCwrQ0FBbUQ7QUFFbkQsMkNBQWtEO0FBQ2xELG9EQUF1RDtBQUV2RCxNQUFNLDBCQUEwQixHQUFHLEtBQUssQ0FBQztBQUN6QyxNQUFNLGVBQWUsR0FBRyxNQUFNLENBQUM7QUFFL0I7Ozs7Ozs7R0FPRztBQUNILE1BQWEsZ0JBQWdCO0lBQ1YsUUFBUSxDQUFXO0lBQ25CLGNBQWMsQ0FBeUI7SUFDdkMsTUFBTSxDQUFVO0lBRWpDLFlBQW1CLFFBQWtCLEVBQUUsY0FBc0MsRUFBRSxNQUFlO1FBQzVGLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxjQUFjLEdBQUcsY0FBYyxDQUFDO1FBQ3JDLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO0lBQ3ZCLENBQUM7SUFFTSxLQUFLLENBQUMsVUFBVSxDQUFDLE9BQWdCO1FBQ3RDLE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUM7WUFDM0QsT0FBTztZQUNQLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtTQUNwQixDQUFDLENBQUM7UUFDSCxNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDakQsT0FBTyxFQUFFLGtCQUFrQixFQUFFLGFBQWEsRUFBRSxDQUFDO0lBQy9DLENBQUM7SUFFRDs7OztPQUlHO0lBQ0ksS0FBSyxDQUFDLHNCQUFzQixDQUNqQyxVQUFrQyxFQUFFO1FBRXBDLE1BQU0sWUFBWSxHQUFHO1lBQ25CLGNBQWMsRUFBRSxJQUFJLENBQUMsY0FBYztZQUNuQyxlQUFlLEVBQUUsU0FBUztZQUMxQixNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU07U0FDdkIsQ0FBQztRQUVGLGlHQUFpRztRQUNqRyxFQUFFO1FBQ0YsNEZBQTRGO1FBQzVGLDRGQUE0RjtRQUM1Riw2RkFBNkY7UUFDN0YscUVBQXFFO1FBQ3JFLEVBQUU7UUFDRix1RkFBdUY7UUFDdkYsc0ZBQXNGO1FBQ3RGLCtGQUErRjtRQUMvRixNQUFNLGtCQUFrQixHQUFHO1lBQ3pCLE1BQU0sRUFBRSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztTQUMzQyxDQUFDO1FBQ0Y7Ozs7Ozs7O1dBUUc7UUFDSCxJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNwQixPQUFPLElBQUEsc0NBQW1CLEVBQUMsSUFBQSw4QkFBTyxFQUFDO2dCQUNqQyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87Z0JBQ3hCLFdBQVcsRUFBRSxJQUFJO2dCQUNqQixlQUFlLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO2dCQUM1QyxZQUFZO2dCQUNaLGtCQUFrQjtnQkFDbEIsTUFBTSxFQUFFLE9BQU8sQ0FBQyxNQUFNO2FBQ3ZCLENBQUMsQ0FBQyxDQUFDO1FBQ04sQ0FBQztRQUVELE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUM7UUFFOUU7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7V0FzQkc7UUFDSCxNQUFNLGlCQUFpQixHQUFHLElBQUEsNENBQXFCLEVBQUM7WUFDOUMsT0FBTyxFQUFFLFVBQVU7WUFDbkIsWUFBWTtZQUNaLGtCQUFrQjtZQUNsQixNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU07WUFDdEIsZUFBZSxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztZQUM1QyxXQUFXLEVBQUUsSUFBSTtTQUNsQixDQUFDLENBQUM7UUFFSCxPQUFPLG1CQUFtQixFQUFFO1lBQzFCLENBQUMsQ0FBQyxJQUFBLDRDQUFxQixFQUFDLElBQUEsOEJBQU8sR0FBRSxFQUFFLGlCQUFpQixDQUFDLENBQUMsV0FBVyxDQUFDLEVBQUUsR0FBRyxNQUFNLENBQUM7WUFDOUUsQ0FBQyxDQUFDLGlCQUFpQixDQUFDO0lBQ3hCLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7OztPQWFHO0lBQ0ksS0FBSyxDQUFDLE1BQU0sQ0FBQyxZQUFxQjtRQUN2QyxNQUFNLGFBQWEsR0FBRyxXQUFXLENBQUM7UUFDbEMsTUFBTSxPQUFPLEdBQUcsWUFBWSxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLElBQUksU0FBUyxDQUFDO1FBRXhHLE1BQU0sTUFBTSxHQUNWLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVTtZQUN0QixPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWE7WUFDekIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0I7WUFDOUIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQkFBcUI7WUFDakMsQ0FBQyxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUN0QyxDQUFDLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUMsQ0FBQztRQUUzQyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDWixNQUFNLFdBQVcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxlQUFlLE9BQU8sSUFBSSxDQUFDO1lBQy9ELE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsWUFBRSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FDakQsdUVBQXVFLFdBQVcsb0JBQW9CLGFBQWEsR0FBRyxDQUN2SCxDQUFDLENBQUM7WUFDSCxPQUFPLGFBQWEsQ0FBQztRQUN2QixDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNLLEtBQUssQ0FBQyx5QkFBeUI7UUFDckMsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxZQUFFLENBQUMsaUJBQWlCLENBQUMsR0FBRyxDQUFDLG9FQUFvRSxDQUFDLENBQUMsQ0FBQztRQUMzSCxJQUFJLENBQUM7WUFDSCxNQUFNLGVBQWUsR0FBRyxJQUFJLHNDQUFlLENBQUM7Z0JBQzFDLFdBQVcsRUFBRTtvQkFDWCxPQUFPLEVBQUUsSUFBSTtpQkFDZDthQUNGLENBQUMsQ0FBQztZQUVILE1BQU0sZUFBZSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDM0MsTUFBTSxRQUFRLEdBQUcsTUFBTSxlQUFlLENBQUMsT0FBTyxDQUFDLDRDQUE0QyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ2pHLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLENBQUM7UUFDckMsQ0FBQztRQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDWCxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFlBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsNENBQTRDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUN4RyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0ssS0FBSyxDQUFDLGdCQUFnQixDQUFDLE9BQWU7UUFDNUMsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFBLDhDQUFxQixFQUFDLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFFdkUsWUFBWTtRQUNaLEVBQUU7UUFDRix1RUFBdUU7UUFDdkUsRUFBRTtRQUNGLG1DQUFtQztRQUNuQyw4QkFBOEI7UUFDOUIsbUNBQW1DO1FBQ25DLDhCQUE4QjtRQUU5QixPQUFPLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLEVBQUUsV0FBVyxDQUFDLGVBQWUsQ0FBQztlQUNuRSxJQUFJLENBQUMsb0JBQW9CLENBQUMsT0FBTyxFQUFFLFdBQVcsQ0FBQyxVQUFVLENBQUM7ZUFDMUQsSUFBSSxDQUFDLG9CQUFvQixDQUFDLFNBQVMsRUFBRSxXQUFXLENBQUMsZUFBZSxDQUFDO2VBQ2pFLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxTQUFTLEVBQUUsV0FBVyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQ2xFLENBQUM7SUFFTyxvQkFBb0IsQ0FBQyxPQUFlLEVBQUUsSUFBVTtRQUN0RCxPQUFPLElBQUksRUFBRSxDQUFDLE9BQU8sQ0FBQyxFQUFFLE1BQU0sQ0FBQztJQUNqQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNLLEtBQUssQ0FBQyxXQUFXLENBQUMsU0FBaUI7UUFDekMsTUFBTSxPQUFPLEdBQUcsQ0FBQyxHQUFXLEVBQUUsR0FBRyxJQUFXLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFlBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsSUFBQSxrQkFBTSxFQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUN0SCxNQUFNLE9BQU8sQ0FBQyxrQ0FBa0MsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUM3RCxJQUFJLENBQUM7WUFDSCxNQUFNLEtBQUssR0FBVyxNQUFNLFFBQVEsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLFNBQVMsSUFBSSxFQUFFO2dCQUMxRSxJQUFJLEVBQUUsSUFBSTtnQkFDVixPQUFPLEVBQUUsRUFBRTthQUNaLENBQUMsQ0FBQztZQUNILE1BQU0sT0FBTyxDQUFDLHNDQUFzQyxDQUFDLENBQUM7WUFDdEQsT0FBTyxLQUFLLENBQUM7UUFDZixDQUFDO1FBQUMsT0FBTyxHQUFRLEVBQUUsQ0FBQztZQUNsQixNQUFNLE9BQU8sQ0FBQyx5QkFBeUIsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUM5QyxNQUFNLENBQUMsR0FBRyxJQUFJLG1DQUFtQixDQUFDLDZCQUE2QixHQUFHLENBQUMsT0FBTyxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUM7WUFDckYsQ0FBQyxDQUFDLElBQUksR0FBRyx5Q0FBeUMsQ0FBQztZQUNuRCxNQUFNLENBQUMsQ0FBQztRQUNWLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUF6TkQsNENBeU5DO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsbUJBQW1CO0lBQzFCLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQztJQUM3RSxNQUFNLEdBQUcsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLHFCQUFxQixJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCLENBQUM7SUFFdEYsSUFBSSxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUNsQixPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixHQUFHLEVBQUUsQ0FBQztRQUNuQyxPQUFPLENBQUMsR0FBRyxDQUFDLHFCQUFxQixHQUFHLEdBQUcsQ0FBQztRQUV4QyxNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLENBQUM7UUFDdkYsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUNqQixPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixHQUFHLFlBQVksQ0FBQztRQUMvQyxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsT0FBTyxLQUFLLENBQUM7QUFDZixDQUFDO0FBT00sS0FBSyxVQUFVLGtCQUFrQixDQUFDLFFBQWtCLEVBQUUsVUFBMEIsRUFBRTtJQUN2RixNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksZ0NBQWtCLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBRXJFLE9BQU87UUFDTCxpQkFBaUIsRUFBRSwwQkFBMEI7UUFDN0MsY0FBYyxFQUFFLGVBQWU7UUFDL0IsVUFBVSxFQUFFLEtBQUs7UUFDakIsU0FBUyxFQUFFLEtBQUs7S0FDakIsQ0FBQztBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBmb3JtYXQgfSBmcm9tICdub2RlOnV0aWwnO1xuaW1wb3J0IHsgY3JlYXRlQ3JlZGVudGlhbENoYWluLCBmcm9tRW52LCBmcm9tSW5pLCBmcm9tTm9kZVByb3ZpZGVyQ2hhaW4gfSBmcm9tICdAYXdzLXNkay9jcmVkZW50aWFsLXByb3ZpZGVycyc7XG5pbXBvcnQgeyBNZXRhZGF0YVNlcnZpY2UgfSBmcm9tICdAYXdzLXNkay9lYzItbWV0YWRhdGEtc2VydmljZSc7XG5pbXBvcnQgdHlwZSB7IE5vZGVIdHRwSGFuZGxlck9wdGlvbnMgfSBmcm9tICdAc21pdGh5L25vZGUtaHR0cC1oYW5kbGVyJztcbmltcG9ydCB7IGxvYWRTaGFyZWRDb25maWdGaWxlcyB9IGZyb20gJ0BzbWl0aHkvc2hhcmVkLWluaS1maWxlLWxvYWRlcic7XG5pbXBvcnQgdHlwZSB7IEF3c0NyZWRlbnRpYWxJZGVudGl0eVByb3ZpZGVyLCBMb2dnZXIgfSBmcm9tICdAc21pdGh5L3R5cGVzJztcbmltcG9ydCAqIGFzIHByb21wdGx5IGZyb20gJ3Byb21wdGx5JztcbmltcG9ydCB7IG1ha2VDYWNoaW5nUHJvdmlkZXIgfSBmcm9tICcuL3Byb3ZpZGVyLWNhY2hpbmcnO1xuaW1wb3J0IHsgUHJveHlBZ2VudFByb3ZpZGVyIH0gZnJvbSAnLi9wcm94eS1hZ2VudCc7XG5pbXBvcnQgdHlwZSB7IFNka0h0dHBPcHRpb25zIH0gZnJvbSAnLi9zZGstcHJvdmlkZXInO1xuaW1wb3J0IHsgSU8sIHR5cGUgSW9IZWxwZXIgfSBmcm9tICcuLi9pby9wcml2YXRlJztcbmltcG9ydCB7IEF1dGhlbnRpY2F0aW9uRXJyb3IgfSBmcm9tICcuLi90b29sa2l0LWVycm9yJztcblxuY29uc3QgREVGQVVMVF9DT05ORUNUSU9OX1RJTUVPVVQgPSAxMDAwMDtcbmNvbnN0IERFRkFVTFRfVElNRU9VVCA9IDMwMDAwMDtcblxuLyoqXG4gKiBCZWhhdmlvcnMgdG8gbWF0Y2ggQVdTIENMSVxuICpcbiAqIFNlZSB0aGVzZSBsaW5rczpcbiAqXG4gKiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vY2xpL2xhdGVzdC90b3BpYy9jb25maWctdmFycy5odG1sXG4gKiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vY2xpL2xhdGVzdC91c2VyZ3VpZGUvY2xpLWNvbmZpZ3VyZS1lbnZ2YXJzLmh0bWxcbiAqL1xuZXhwb3J0IGNsYXNzIEF3c0NsaUNvbXBhdGlibGUge1xuICBwcml2YXRlIHJlYWRvbmx5IGlvSGVscGVyOiBJb0hlbHBlcjtcbiAgcHJpdmF0ZSByZWFkb25seSByZXF1ZXN0SGFuZGxlcjogTm9kZUh0dHBIYW5kbGVyT3B0aW9ucztcbiAgcHJpdmF0ZSByZWFkb25seSBsb2dnZXI/OiBMb2dnZXI7XG5cbiAgcHVibGljIGNvbnN0cnVjdG9yKGlvSGVscGVyOiBJb0hlbHBlciwgcmVxdWVzdEhhbmRsZXI6IE5vZGVIdHRwSGFuZGxlck9wdGlvbnMsIGxvZ2dlcj86IExvZ2dlcikge1xuICAgIHRoaXMuaW9IZWxwZXIgPSBpb0hlbHBlcjtcbiAgICB0aGlzLnJlcXVlc3RIYW5kbGVyID0gcmVxdWVzdEhhbmRsZXI7XG4gICAgdGhpcy5sb2dnZXIgPSBsb2dnZXI7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgYmFzZUNvbmZpZyhwcm9maWxlPzogc3RyaW5nKTogUHJvbWlzZTx7IGNyZWRlbnRpYWxQcm92aWRlcjogQXdzQ3JlZGVudGlhbElkZW50aXR5UHJvdmlkZXI7IGRlZmF1bHRSZWdpb246IHN0cmluZyB9PiB7XG4gICAgY29uc3QgY3JlZGVudGlhbFByb3ZpZGVyID0gYXdhaXQgdGhpcy5jcmVkZW50aWFsQ2hhaW5CdWlsZGVyKHtcbiAgICAgIHByb2ZpbGUsXG4gICAgICBsb2dnZXI6IHRoaXMubG9nZ2VyLFxuICAgIH0pO1xuICAgIGNvbnN0IGRlZmF1bHRSZWdpb24gPSBhd2FpdCB0aGlzLnJlZ2lvbihwcm9maWxlKTtcbiAgICByZXR1cm4geyBjcmVkZW50aWFsUHJvdmlkZXIsIGRlZmF1bHRSZWdpb24gfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZCBhbiBBV1MgQ0xJLWNvbXBhdGlibGUgY3JlZGVudGlhbCBjaGFpbiBwcm92aWRlclxuICAgKlxuICAgKiBUaGUgY3JlZGVudGlhbCBjaGFpbiByZXR1cm5lZCBieSB0aGlzIGZ1bmN0aW9uIGlzIGFsd2F5cyBjYWNoaW5nLlxuICAgKi9cbiAgcHVibGljIGFzeW5jIGNyZWRlbnRpYWxDaGFpbkJ1aWxkZXIoXG4gICAgb3B0aW9uczogQ3JlZGVudGlhbENoYWluT3B0aW9ucyA9IHt9LFxuICApOiBQcm9taXNlPEF3c0NyZWRlbnRpYWxJZGVudGl0eVByb3ZpZGVyPiB7XG4gICAgY29uc3QgY2xpZW50Q29uZmlnID0ge1xuICAgICAgcmVxdWVzdEhhbmRsZXI6IHRoaXMucmVxdWVzdEhhbmRsZXIsXG4gICAgICBjdXN0b21Vc2VyQWdlbnQ6ICdhd3MtY2RrJyxcbiAgICAgIGxvZ2dlcjogb3B0aW9ucy5sb2dnZXIsXG4gICAgfTtcblxuICAgIC8vIFN1cGVyIGhhY2t5IHNvbHV0aW9uIHRvIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvYXdzLWNkay9pc3N1ZXMvMzI1MTAsIHByb3Bvc2VkIGJ5IHRoZSBTREsgdGVhbS5cbiAgICAvL1xuICAgIC8vIFN1bW1hcnkgb2YgdGhlIHByb2JsZW06IHdlIHdlcmUgcmVhZGluZyB0aGUgcmVnaW9uIGZyb20gdGhlIGNvbmZpZyBmaWxlIGFuZCBwYXNzaW5nIGl0IHRvXG4gICAgLy8gdGhlIGNyZWRlbnRpYWwgcHJvdmlkZXJzLiBIb3dldmVyLCBpbiB0aGUgY2FzZSBvZiBTU08sIHRoaXMgbWFrZXMgdGhlIGNyZWRlbnRpYWwgcHJvdmlkZXJcbiAgICAvLyB1c2UgdGhhdCByZWdpb24gdG8gZG8gdGhlIFNTTyBmbG93LCB3aGljaCBpcyBpbmNvcnJlY3QuIFRoZSByZWdpb24gdGhhdCBzaG91bGQgYmUgdXNlZCBmb3JcbiAgICAvLyB0aGF0IGlzIHRoZSBvbmUgc2V0IGluIHRoZSBzc29fc2Vzc2lvbiBzZWN0aW9uIG9mIHRoZSBjb25maWcgZmlsZS5cbiAgICAvL1xuICAgIC8vIFRoZSBpZGVhIGhlcmU6IHRoZSBcImNsaWVudENvbmZpZ1wiIGlzIGZvciBjb25maWd1cmluZyB0aGUgaW5uZXIgYXV0aCBjbGllbnQgZGlyZWN0bHksXG4gICAgLy8gYW5kIGhhcyB0aGUgaGlnaGVzdCBwcmlvcml0eSwgd2hlcmVhcyBcInBhcmVudENsaWVudENvbmZpZ1wiIGlzIHRoZSB1cHBlciBkYXRhIGNsaWVudFxuICAgIC8vIGFuZCBoYXMgbG93ZXIgcHJpb3JpdHkgdGhhbiB0aGUgc3NvX3JlZ2lvbiBidXQgc3RpbGwgaGlnaGVyIHByaW9yaXR5IHRoYW4gU1RTIGdsb2JhbCByZWdpb24uXG4gICAgY29uc3QgcGFyZW50Q2xpZW50Q29uZmlnID0ge1xuICAgICAgcmVnaW9uOiBhd2FpdCB0aGlzLnJlZ2lvbihvcHRpb25zLnByb2ZpbGUpLFxuICAgIH07XG4gICAgLyoqXG4gICAgICogVGhlIHByZXZpb3VzIGltcGxlbWVudGF0aW9uIG1hdGNoZWQgQVdTIENMSSBiZWhhdmlvcjpcbiAgICAgKlxuICAgICAqIElmIGEgcHJvZmlsZSBpcyBleHBsaWNpdGx5IHNldCB1c2luZyBgLS1wcm9maWxlYCxcbiAgICAgKiB3ZSB1c2UgdGhhdCB0byB0aGUgZXhjbHVzaW9uIG9mIGV2ZXJ5dGhpbmcgZWxzZS5cbiAgICAgKlxuICAgICAqIE5vdGU6IHRoaXMgZG9lcyBub3QgYXBwbHkgdG8gQVdTX1BST0ZJTEUsXG4gICAgICogZW52aXJvbm1lbnQgY3JlZGVudGlhbHMgc3RpbGwgdGFrZSBwcmVjZWRlbmNlIG92ZXIgQVdTX1BST0ZJTEVcbiAgICAgKi9cbiAgICBpZiAob3B0aW9ucy5wcm9maWxlKSB7XG4gICAgICByZXR1cm4gbWFrZUNhY2hpbmdQcm92aWRlcihmcm9tSW5pKHtcbiAgICAgICAgcHJvZmlsZTogb3B0aW9ucy5wcm9maWxlLFxuICAgICAgICBpZ25vcmVDYWNoZTogdHJ1ZSxcbiAgICAgICAgbWZhQ29kZVByb3ZpZGVyOiB0aGlzLnRva2VuQ29kZUZuLmJpbmQodGhpcyksXG4gICAgICAgIGNsaWVudENvbmZpZyxcbiAgICAgICAgcGFyZW50Q2xpZW50Q29uZmlnLFxuICAgICAgICBsb2dnZXI6IG9wdGlvbnMubG9nZ2VyLFxuICAgICAgfSkpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudlByb2ZpbGUgPSBwcm9jZXNzLmVudi5BV1NfUFJPRklMRSB8fCBwcm9jZXNzLmVudi5BV1NfREVGQVVMVF9QUk9GSUxFO1xuXG4gICAgLyoqXG4gICAgICogRW52IEFXUyAtIEVudmlyb25tZW50Q3JlZGVudGlhbHMgd2l0aCBzdHJpbmcgQVdTXG4gICAgICogRW52IEFtYXpvbiAtIEVudmlyb25tZW50Q3JlZGVudGlhbHMgd2l0aCBzdHJpbmcgQU1BWk9OXG4gICAgICogUHJvZmlsZSBDcmVkZW50aWFscyAtIFBhdGNoZWRTaGFyZWRJbmlGaWxlQ3JlZGVudGlhbHMgd2l0aCBpbXBsaWNpdCBwcm9maWxlLCBjcmVkZW50aWFscyBmaWxlLCBodHRwIG9wdGlvbnMsIGFuZCB0b2tlbiBmblxuICAgICAqICAgIFNTTyB3aXRoIGltcGxpY2l0IHByb2ZpbGUgb25seVxuICAgICAqICAgIFNoYXJlZEluaUZpbGVDcmVkZW50aWFscyB3aXRoIGltcGxpY2l0IHByb2ZpbGUgYW5kIHByZWZlclN0YXRpY0NyZWRlbnRpYWxzIHRydWUgKHByb2ZpbGUgd2l0aCBzb3VyY2VfcHJvZmlsZSlcbiAgICAgKiAgICBTaGFyZWQgQ3JlZGVudGlhbCBmaWxlIHRoYXQgcG9pbnRzIHRvIEVudmlyb25tZW50IENyZWRlbnRpYWxzIHdpdGggQVdTIHByZWZpeFxuICAgICAqICAgIFNoYXJlZCBDcmVkZW50aWFsIGZpbGUgdGhhdCBwb2ludHMgdG8gRUMyIE1ldGFkYXRhXG4gICAgICogICAgU2hhcmVkIENyZWRlbnRpYWwgZmlsZSB0aGF0IHBvaW50cyB0byBFQ1MgQ3JlZGVudGlhbHNcbiAgICAgKiBTU08gQ3JlZGVudGlhbHMgLSBTc29DcmVkZW50aWFscyB3aXRoIGltcGxpY2l0IHByb2ZpbGUgYW5kIGh0dHAgb3B0aW9uc1xuICAgICAqIFByb2Nlc3NDcmVkZW50aWFscyB3aXRoIGltcGxpY2l0IHByb2ZpbGVcbiAgICAgKiBFQ1MgQ3JlZGVudGlhbHMgLSBFQ1NDcmVkZW50aWFscyB3aXRoIG5vIGlucHV0IE9SIFdlYiBJZGVudGl0eSAtIFRva2VuRmlsZVdlYklkZW50aXR5Q3JlZGVudGlhbHMgd2l0aCBubyBpbnB1dCBPUiBFQzIgTWV0YWRhdGEgLSBFQzJNZXRhZGF0YUNyZWRlbnRpYWxzIHdpdGggbm8gaW5wdXRcbiAgICAgKlxuICAgICAqIFRoZXNlIHRyYW5zbGF0ZSB0bzpcbiAgICAgKiBmcm9tRW52KClcbiAgICAgKiBmcm9tU1NPKCkvZnJvbUluaSgpXG4gICAgICogZnJvbVByb2Nlc3MoKVxuICAgICAqIGZyb21Db250YWluZXJNZXRhZGF0YSgpXG4gICAgICogZnJvbVRva2VuRmlsZSgpXG4gICAgICogZnJvbUluc3RhbmNlTWV0YWRhdGEoKVxuICAgICAqXG4gICAgICogVGhlIE5vZGVQcm92aWRlckNoYWluIGlzIGFscmVhZHkgY2FjaGVkLlxuICAgICAqL1xuICAgIGNvbnN0IG5vZGVQcm92aWRlckNoYWluID0gZnJvbU5vZGVQcm92aWRlckNoYWluKHtcbiAgICAgIHByb2ZpbGU6IGVudlByb2ZpbGUsXG4gICAgICBjbGllbnRDb25maWcsXG4gICAgICBwYXJlbnRDbGllbnRDb25maWcsXG4gICAgICBsb2dnZXI6IG9wdGlvbnMubG9nZ2VyLFxuICAgICAgbWZhQ29kZVByb3ZpZGVyOiB0aGlzLnRva2VuQ29kZUZuLmJpbmQodGhpcyksXG4gICAgICBpZ25vcmVDYWNoZTogdHJ1ZSxcbiAgICB9KTtcblxuICAgIHJldHVybiBzaG91bGRQcmlvcml0aXplRW52KClcbiAgICAgID8gY3JlYXRlQ3JlZGVudGlhbENoYWluKGZyb21FbnYoKSwgbm9kZVByb3ZpZGVyQ2hhaW4pLmV4cGlyZUFmdGVyKDYwICogNjBfMDAwKVxuICAgICAgOiBub2RlUHJvdmlkZXJDaGFpbjtcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRlbXB0cyB0byBnZXQgdGhlIHJlZ2lvbiBmcm9tIGEgbnVtYmVyIG9mIHNvdXJjZXMgYW5kIGZhbGxzIGJhY2sgdG8gdXMtZWFzdC0xIGlmIG5vIHJlZ2lvbiBjYW4gYmUgZm91bmQsXG4gICAqIGFzIGlzIGRvbmUgaW4gdGhlIEFXUyBDTEkuXG4gICAqXG4gICAqIFRoZSBvcmRlciBvZiBwcmlvcml0eSBpcyB0aGUgZm9sbG93aW5nOlxuICAgKlxuICAgKiAxLiBFbnZpcm9ubWVudCB2YXJpYWJsZXMgc3BlY2lmeWluZyByZWdpb24sIHdpdGggYm90aCBhbiBBV1MgcHJlZml4IGFuZCBBTUFaT04gcHJlZml4XG4gICAqICAgIHRvIG1haW50YWluIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5LCBhbmQgd2l0aG91dCBgREVGQVVMVGAgaW4gdGhlIG5hbWUgYmVjYXVzZVxuICAgKiAgICBMYW1iZGEgYW5kIENvZGVCdWlsZCBzZXQgdGhlICRBV1NfUkVHSU9OIHZhcmlhYmxlLlxuICAgKiAyLiBSZWdpb25zIGxpc3RlZCBpbiB0aGUgU2hhcmVkIEluaSBGaWxlcyAtIEZpcnN0IGNoZWNraW5nIGZvciB0aGUgcHJvZmlsZSBwcm92aWRlZFxuICAgKiAgICBhbmQgdGhlbiBjaGVja2luZyBmb3IgdGhlIGRlZmF1bHQgcHJvZmlsZS5cbiAgICogMy4gSU1EUyBpbnN0YW5jZSBpZGVudGl0eSByZWdpb24gZnJvbSB0aGUgTWV0YWRhdGEgU2VydmljZS5cbiAgICogNC4gdXMtZWFzdC0xXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgcmVnaW9uKG1heWJlUHJvZmlsZT86IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgZGVmYXVsdFJlZ2lvbiA9ICd1cy1lYXN0LTEnO1xuICAgIGNvbnN0IHByb2ZpbGUgPSBtYXliZVByb2ZpbGUgfHwgcHJvY2Vzcy5lbnYuQVdTX1BST0ZJTEUgfHwgcHJvY2Vzcy5lbnYuQVdTX0RFRkFVTFRfUFJPRklMRSB8fCAnZGVmYXVsdCc7XG5cbiAgICBjb25zdCByZWdpb24gPVxuICAgICAgcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fFxuICAgICAgcHJvY2Vzcy5lbnYuQU1BWk9OX1JFR0lPTiB8fFxuICAgICAgcHJvY2Vzcy5lbnYuQVdTX0RFRkFVTFRfUkVHSU9OIHx8XG4gICAgICBwcm9jZXNzLmVudi5BTUFaT05fREVGQVVMVF9SRUdJT04gfHxcbiAgICAgIChhd2FpdCB0aGlzLmdldFJlZ2lvbkZyb21JbmkocHJvZmlsZSkpIHx8XG4gICAgICAoYXdhaXQgdGhpcy5yZWdpb25Gcm9tTWV0YWRhdGFTZXJ2aWNlKCkpO1xuXG4gICAgaWYgKCFyZWdpb24pIHtcbiAgICAgIGNvbnN0IHVzZWRQcm9maWxlID0gIXByb2ZpbGUgPyAnJyA6IGAgKHByb2ZpbGU6IFwiJHtwcm9maWxlfVwiKWA7XG4gICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1NES19ERUJVRy5tc2coXG4gICAgICAgIGBVbmFibGUgdG8gZGV0ZXJtaW5lIEFXUyByZWdpb24gZnJvbSBlbnZpcm9ubWVudCBvciBBV1MgY29uZmlndXJhdGlvbiR7dXNlZFByb2ZpbGV9LCBkZWZhdWx0aW5nIHRvICcke2RlZmF1bHRSZWdpb259J2AsXG4gICAgICApKTtcbiAgICAgIHJldHVybiBkZWZhdWx0UmVnaW9uO1xuICAgIH1cblxuICAgIHJldHVybiByZWdpb247XG4gIH1cblxuICAvKipcbiAgICogVGhlIE1ldGFkYXRhU2VydmljZSBjbGFzcyB3aWxsIGF0dGVtcHQgdG8gZmV0Y2ggdGhlIGluc3RhbmNlIGlkZW50aXR5IGRvY3VtZW50IGZyb21cbiAgICogSU1EU3YyIGZpcnN0LCBhbmQgdGhlbiB3aWxsIGF0dGVtcHQgdjEgYXMgYSBmYWxsYmFjay5cbiAgICpcbiAgICogSWYgdGhpcyBmYWlscywgd2Ugd2lsbCB1c2UgdXMtZWFzdC0xIGFzIHRoZSByZWdpb24gc28gbm8gZXJyb3Igc2hvdWxkIGJlIHRocm93bi5cbiAgICogQHJldHVybnMgVGhlIHJlZ2lvbiBmb3IgdGhlIGluc3RhbmNlIGlkZW50aXR5XG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHJlZ2lvbkZyb21NZXRhZGF0YVNlcnZpY2UoKSB7XG4gICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9TREtfREVCVUcubXNnKCdMb29raW5nIHVwIEFXUyByZWdpb24gaW4gdGhlIEVDMiBJbnN0YW5jZSBNZXRhZGF0YSBTZXJ2aWNlIChJTURTKS4nKSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG1ldGFkYXRhU2VydmljZSA9IG5ldyBNZXRhZGF0YVNlcnZpY2Uoe1xuICAgICAgICBodHRwT3B0aW9uczoge1xuICAgICAgICAgIHRpbWVvdXQ6IDEwMDAsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgbWV0YWRhdGFTZXJ2aWNlLmZldGNoTWV0YWRhdGFUb2tlbigpO1xuICAgICAgY29uc3QgZG9jdW1lbnQgPSBhd2FpdCBtZXRhZGF0YVNlcnZpY2UucmVxdWVzdCgnL2xhdGVzdC9keW5hbWljL2luc3RhbmNlLWlkZW50aXR5L2RvY3VtZW50Jywge30pO1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UoZG9jdW1lbnQpLnJlZ2lvbjtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1NES19ERUJVRy5tc2coYFVuYWJsZSB0byByZXRyaWV2ZSBBV1MgcmVnaW9uIGZyb20gSU1EUzogJHtlfWApKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9va3MgdXAgdGhlIHJlZ2lvbiBvZiB0aGUgcHJvdmlkZWQgcHJvZmlsZS4gSWYgbm8gcmVnaW9uIGlzIHByZXNlbnQsXG4gICAqIGl0IHdpbGwgYXR0ZW1wdCB0byBsb29rdXAgdGhlIGRlZmF1bHQgcmVnaW9uLlxuICAgKiBAcGFyYW0gcHJvZmlsZSBUaGUgcHJvZmlsZSB0byB1c2UgdG8gbG9va3VwIHRoZSByZWdpb25cbiAgICogQHJldHVybnMgVGhlIHJlZ2lvbiBmb3IgdGhlIHByb2ZpbGUgb3IgZGVmYXVsdCBwcm9maWxlLCBpZiBwcmVzZW50LiBPdGhlcndpc2UgcmV0dXJucyB1bmRlZmluZWQuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGdldFJlZ2lvbkZyb21JbmkocHJvZmlsZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCBzaGFyZWRGaWxlcyA9IGF3YWl0IGxvYWRTaGFyZWRDb25maWdGaWxlcyh7IGlnbm9yZUNhY2hlOiB0cnVlIH0pO1xuXG4gICAgLy8gUHJpb3JpdHk6XG4gICAgLy9cbiAgICAvLyBjcmVkZW50aWFscyBjb21lIGJlZm9yZSBjb25maWcgYmVjYXVzZSBhd3MtY2xpIHYxIGJlaGF2ZXMgbGlrZSB0aGF0LlxuICAgIC8vXG4gICAgLy8gMS4gcHJvZmlsZS1yZWdpb24taW4tY3JlZGVudGlhbHNcbiAgICAvLyAyLiBwcm9maWxlLXJlZ2lvbi1pbi1jb25maWdcbiAgICAvLyAzLiBkZWZhdWx0LXJlZ2lvbi1pbi1jcmVkZW50aWFsc1xuICAgIC8vIDQuIGRlZmF1bHQtcmVnaW9uLWluLWNvbmZpZ1xuXG4gICAgcmV0dXJuIHRoaXMuZ2V0UmVnaW9uRnJvbUluaUZpbGUocHJvZmlsZSwgc2hhcmVkRmlsZXMuY3JlZGVudGlhbHNGaWxlKVxuICAgID8/IHRoaXMuZ2V0UmVnaW9uRnJvbUluaUZpbGUocHJvZmlsZSwgc2hhcmVkRmlsZXMuY29uZmlnRmlsZSlcbiAgICA/PyB0aGlzLmdldFJlZ2lvbkZyb21JbmlGaWxlKCdkZWZhdWx0Jywgc2hhcmVkRmlsZXMuY3JlZGVudGlhbHNGaWxlKVxuICAgID8/IHRoaXMuZ2V0UmVnaW9uRnJvbUluaUZpbGUoJ2RlZmF1bHQnLCBzaGFyZWRGaWxlcy5jb25maWdGaWxlKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0UmVnaW9uRnJvbUluaUZpbGUocHJvZmlsZTogc3RyaW5nLCBkYXRhPzogYW55KSB7XG4gICAgcmV0dXJuIGRhdGE/Lltwcm9maWxlXT8ucmVnaW9uO1xuICB9XG5cbiAgLyoqXG4gICAqIEFzayB1c2VyIGZvciBNRkEgdG9rZW4gZm9yIGdpdmVuIHNlcmlhbFxuICAgKlxuICAgKiBSZXN1bHQgaXMgc2VuZCB0byBjYWxsYmFjayBmdW5jdGlvbiBmb3IgU0RLIHRvIGF1dGhvcml6ZSB0aGUgcmVxdWVzdFxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyB0b2tlbkNvZGVGbihzZXJpYWxBcm46IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgZGVidWdGbiA9IChtc2c6IHN0cmluZywgLi4uYXJnczogYW55W10pID0+IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfU0RLX0RFQlVHLm1zZyhmb3JtYXQobXNnLCAuLi5hcmdzKSkpO1xuICAgIGF3YWl0IGRlYnVnRm4oJ1JlcXVpcmUgTUZBIHRva2VuIGZvciBzZXJpYWwgQVJOJywgc2VyaWFsQXJuKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdG9rZW46IHN0cmluZyA9IGF3YWl0IHByb21wdGx5LnByb21wdChgTUZBIHRva2VuIGZvciAke3NlcmlhbEFybn06IGAsIHtcbiAgICAgICAgdHJpbTogdHJ1ZSxcbiAgICAgICAgZGVmYXVsdDogJycsXG4gICAgICB9KTtcbiAgICAgIGF3YWl0IGRlYnVnRm4oJ1N1Y2Nlc3NmdWxseSBnb3QgTUZBIHRva2VuIGZyb20gdXNlcicpO1xuICAgICAgcmV0dXJuIHRva2VuO1xuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICBhd2FpdCBkZWJ1Z0ZuKCdGYWlsZWQgdG8gZ2V0IE1GQSB0b2tlbicsIGVycik7XG4gICAgICBjb25zdCBlID0gbmV3IEF1dGhlbnRpY2F0aW9uRXJyb3IoYEVycm9yIGZldGNoaW5nIE1GQSB0b2tlbjogJHtlcnIubWVzc2FnZSA/PyBlcnJ9YCk7XG4gICAgICBlLm5hbWUgPSAnU2hhcmVkSW5pRmlsZUNyZWRlbnRpYWxzUHJvdmlkZXJGYWlsdXJlJztcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogV2UgdXNlZCB0byBzdXBwb3J0IGJvdGggQVdTIGFuZCBBTUFaT04gcHJlZml4ZXMgZm9yIHRoZXNlIGVudmlyb25tZW50IHZhcmlhYmxlcy5cbiAqXG4gKiBBZGRpbmcgdGhpcyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eS5cbiAqL1xuZnVuY3Rpb24gc2hvdWxkUHJpb3JpdGl6ZUVudigpIHtcbiAgY29uc3QgaWQgPSBwcm9jZXNzLmVudi5BV1NfQUNDRVNTX0tFWV9JRCB8fCBwcm9jZXNzLmVudi5BTUFaT05fQUNDRVNTX0tFWV9JRDtcbiAgY29uc3Qga2V5ID0gcHJvY2Vzcy5lbnYuQVdTX1NFQ1JFVF9BQ0NFU1NfS0VZIHx8IHByb2Nlc3MuZW52LkFNQVpPTl9TRUNSRVRfQUNDRVNTX0tFWTtcblxuICBpZiAoISFpZCAmJiAhIWtleSkge1xuICAgIHByb2Nlc3MuZW52LkFXU19BQ0NFU1NfS0VZX0lEID0gaWQ7XG4gICAgcHJvY2Vzcy5lbnYuQVdTX1NFQ1JFVF9BQ0NFU1NfS0VZID0ga2V5O1xuXG4gICAgY29uc3Qgc2Vzc2lvblRva2VuID0gcHJvY2Vzcy5lbnYuQVdTX1NFU1NJT05fVE9LRU4gPz8gcHJvY2Vzcy5lbnYuQU1BWk9OX1NFU1NJT05fVE9LRU47XG4gICAgaWYgKHNlc3Npb25Ub2tlbikge1xuICAgICAgcHJvY2Vzcy5lbnYuQVdTX1NFU1NJT05fVE9LRU4gPSBzZXNzaW9uVG9rZW47XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICByZXR1cm4gZmFsc2U7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ3JlZGVudGlhbENoYWluT3B0aW9ucyB7XG4gIHJlYWRvbmx5IHByb2ZpbGU/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IGxvZ2dlcj86IExvZ2dlcjtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1ha2VSZXF1ZXN0SGFuZGxlcihpb0hlbHBlcjogSW9IZWxwZXIsIG9wdGlvbnM6IFNka0h0dHBPcHRpb25zID0ge30pOiBQcm9taXNlPE5vZGVIdHRwSGFuZGxlck9wdGlvbnM+IHtcbiAgY29uc3QgYWdlbnQgPSBhd2FpdCBuZXcgUHJveHlBZ2VudFByb3ZpZGVyKGlvSGVscGVyKS5jcmVhdGUob3B0aW9ucyk7XG5cbiAgcmV0dXJuIHtcbiAgICBjb25uZWN0aW9uVGltZW91dDogREVGQVVMVF9DT05ORUNUSU9OX1RJTUVPVVQsXG4gICAgcmVxdWVzdFRpbWVvdXQ6IERFRkFVTFRfVElNRU9VVCxcbiAgICBodHRwc0FnZW50OiBhZ2VudCxcbiAgICBodHRwQWdlbnQ6IGFnZW50LFxuICB9O1xufVxuIl19