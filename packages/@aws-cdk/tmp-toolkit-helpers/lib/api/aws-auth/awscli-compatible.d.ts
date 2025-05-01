import type { NodeHttpHandlerOptions } from '@smithy/node-http-handler';
import type { AwsCredentialIdentityProvider, Logger } from '@smithy/types';
import type { SdkHttpOptions } from './sdk-provider';
import { type IoHelper } from '../io/private';
/**
 * Behaviors to match AWS CLI
 *
 * See these links:
 *
 * https://docs.aws.amazon.com/cli/latest/topic/config-vars.html
 * https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html
 */
export declare class AwsCliCompatible {
    private readonly ioHelper;
    private readonly requestHandler;
    private readonly logger?;
    constructor(ioHelper: IoHelper, requestHandler: NodeHttpHandlerOptions, logger?: Logger);
    baseConfig(profile?: string): Promise<{
        credentialProvider: AwsCredentialIdentityProvider;
        defaultRegion: string;
    }>;
    /**
     * Build an AWS CLI-compatible credential chain provider
     *
     * The credential chain returned by this function is always caching.
     */
    credentialChainBuilder(options?: CredentialChainOptions): Promise<AwsCredentialIdentityProvider>;
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
    region(maybeProfile?: string): Promise<string>;
    /**
     * The MetadataService class will attempt to fetch the instance identity document from
     * IMDSv2 first, and then will attempt v1 as a fallback.
     *
     * If this fails, we will use us-east-1 as the region so no error should be thrown.
     * @returns The region for the instance identity
     */
    private regionFromMetadataService;
    /**
     * Looks up the region of the provided profile. If no region is present,
     * it will attempt to lookup the default region.
     * @param profile The profile to use to lookup the region
     * @returns The region for the profile or default profile, if present. Otherwise returns undefined.
     */
    private getRegionFromIni;
    private getRegionFromIniFile;
    /**
     * Ask user for MFA token for given serial
     *
     * Result is send to callback function for SDK to authorize the request
     */
    private tokenCodeFn;
}
export interface CredentialChainOptions {
    readonly profile?: string;
    readonly logger?: Logger;
}
export declare function makeRequestHandler(ioHelper: IoHelper, options?: SdkHttpOptions): Promise<NodeHttpHandlerOptions>;
