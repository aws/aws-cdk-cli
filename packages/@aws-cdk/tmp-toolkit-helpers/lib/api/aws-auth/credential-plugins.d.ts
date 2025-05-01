import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { type IoHelper } from '../io/private';
import type { PluginHost } from '../plugin';
import type { Mode } from '../plugin/mode';
/**
 * Cache for credential providers.
 *
 * Given an account and an operating mode (read or write) will return an
 * appropriate credential provider for credentials for the given account. The
 * credential provider will be cached so that multiple AWS clients for the same
 * environment will not make multiple network calls to obtain credentials.
 *
 * Will use default credentials if they are for the right account; otherwise,
 * all loaded credential provider plugins will be tried to obtain credentials
 * for the given account.
 */
export declare class CredentialPlugins {
    private readonly host;
    private readonly ioHelper;
    private readonly cache;
    constructor(host: PluginHost, ioHelper: IoHelper);
    fetchCredentialsFor(awsAccountId: string, mode: Mode): Promise<PluginCredentialsFetchResult | undefined>;
    get availablePluginNames(): string[];
    private lookupCredentials;
}
/**
 * Result from trying to fetch credentials from the Plugin host
 */
export interface PluginCredentialsFetchResult {
    /**
     * SDK-v3 compatible credential provider
     */
    readonly credentials: AwsCredentialIdentityProvider;
    /**
     * Name of plugin that successfully provided credentials
     */
    readonly pluginName: string;
}
