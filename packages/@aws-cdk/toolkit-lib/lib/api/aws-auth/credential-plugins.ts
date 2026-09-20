import type { CredentialProviderSource, ForReading, ForWriting, PluginProviderResult, SDKv2CompatibleCredentials, SDKv3CompatibleCredentialProvider, SDKv3CompatibleCredentials } from '@aws-cdk/cli-plugin-contract';
import { credentialsAboutToExpire, makeCachingProvider } from './provider-caching';
import { AuthenticationError } from '../../toolkit/toolkit-error';
import { describeValueType, formatErrorMessage } from '../../util';
import { IO, type IoHelper } from '../io/private';
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
export class CredentialPlugins {
  private readonly cache: { [key: string]: PluginCredentialsFetchResult | undefined } = {};

  constructor(private readonly host: PluginHost, private readonly ioHelper: IoHelper) {
  }

  public async fetchCredentialsFor(awsAccountId: string, mode: Mode): Promise<PluginCredentialsFetchResult | undefined> {
    const key = `${awsAccountId}-${mode}`;
    if (!(key in this.cache)) {
      this.cache[key] = await this.lookupCredentials(awsAccountId, mode);
    }
    return this.cache[key];
  }

  public get availablePluginNames(): string[] {
    return this.host.credentialProviderSources.map((s) => s.name);
  }

  private async lookupCredentials(awsAccountId: string, mode: Mode): Promise<PluginCredentialsFetchResult | undefined> {
    const triedSources: CredentialProviderSource[] = [];
    // Otherwise, inspect the various credential sources we have
    for (const source of this.host.credentialProviderSources) {
      let available: boolean;
      try {
        available = await source.isAvailable();
      } catch (e: any) {
        // This shouldn't happen, but let's guard against it anyway
        await this.ioHelper.notify(IO.CDK_TOOLKIT_W0100.msg(`Uncaught exception in ${source.name}: ${formatErrorMessage(e)}`));
        available = false;
      }

      if (!available) {
        await this.ioHelper.defaults.debug(`Credentials source ${source.name} is not available, ignoring it.`);
        continue;
      }
      triedSources.push(source);
      let canProvide: boolean;
      try {
        canProvide = await source.canProvideCredentials(awsAccountId);
      } catch (e: any) {
        // This shouldn't happen, but let's guard against it anyway
        await this.ioHelper.notify(IO.CDK_TOOLKIT_W0100.msg(`Uncaught exception in ${source.name}: ${formatErrorMessage(e)}`));
        canProvide = false;
      }
      if (!canProvide) {
        continue;
      }
      await this.ioHelper.defaults.debug(`Using ${source.name} credentials for account ${awsAccountId}`);

      return {
        credentials: await v3ProviderFromPlugin(source.name, () => source.getProvider(awsAccountId, mode as ForReading | ForWriting, {
          supportsV3Providers: true,
        })),
        pluginName: source.name,
      };
    }
    return undefined;
  }
}

/**
 * Result from trying to fetch credentials from the Plugin host
 */
export interface PluginCredentialsFetchResult {
  /**
   * SDK-v3 compatible credential provider
   */
  readonly credentials: SDKv3CompatibleCredentialProvider;

  /**
   * Name of plugin that successfully provided credentials
   */
  readonly pluginName: string;
}

/**
 * Take a function that calls the plugin, and turn it into an SDKv3-compatible credential provider.
 *
 * What we will do is the following:
 *
 * - Query the plugin and see what kind of result it gives us.
 * - If the result is self-refreshing or doesn't need refreshing, we turn it into an SDKv3 provider
 *   and return it directly.
 *   * If the underlying return value is a provider, we will make it a caching provider
 *     (because we can't know if it will cache by itself or not).
 *   * If the underlying return value is a static credential, caching isn't relevant.
 *   * If the underlying return value is V2 credentials, those have caching built-in.
 * - If the result is a static credential that expires, we will wrap it in an SDKv3 provider
 *   that will query the plugin again when the credential expires.
 *
 * @param sourceName - name of the credential provider source that produced the value, used in error messages
 * @param producer - function that queries the plugin for a credential value
 */
async function v3ProviderFromPlugin(sourceName: string, producer: () => Promise<PluginProviderResult>): Promise<SDKv3CompatibleCredentialProvider> {
  const initial = await producer();

  if (isV3Provider(initial)) {
    // Already a provider, make caching
    return makeCachingProvider(initial);
  } else if (isV3Credentials(initial) && initial.expiration === undefined) {
    // Static credentials that don't need refreshing nor caching
    return () => Promise.resolve(initial);
  } else if (isV3Credentials(initial) && initial.expiration !== undefined) {
    // Static credentials that do need refreshing and caching
    return refreshFromPluginProvider(sourceName, initial, producer);
  } else if (isV2Credentials(initial)) {
    // V2 credentials that refresh and cache themselves
    return v3ProviderFromV2Credentials(initial);
  } else {
    // Do NOT inspect, stringify or otherwise traverse the rejected value: it may hold the plugin's
    // AWS credentials, and this message is printed to stderr (and into CI logs).
    // Even reading its keys is unsafe, because property names can be secrets and traversal can
    // trigger getters or proxy traps. Describe the type only, and give the operator the CDK-side
    // identifiers (source name, phase, violated contract) instead.
    throw new AuthenticationError('InvalidPluginCredentials', `Plugin returned a value that doesn't resemble AWS credentials: credential provider source '${sourceName}' returned a value of type '${describeValueType(initial)}' during initial credential resolution. The value is not shown because it may contain credentials. A plugin must return either an SDKv3 credential provider (a function), SDKv3 credentials (an object with a non-empty 'accessKeyId'), or SDKv2-compatible credentials (an object with a 'getPromise' method).`);
  }
}

/**
 * Converts a V2 credential into a V3-compatible provider
 */
function v3ProviderFromV2Credentials(x: SDKv2CompatibleCredentials): SDKv3CompatibleCredentialProvider {
  return async () => {
    // Get will fetch or refresh as necessary
    await x.getPromise();

    return {
      accessKeyId: x.accessKeyId,
      secretAccessKey: x.secretAccessKey,
      sessionToken: x.sessionToken,
      expiration: x.expireTime ?? undefined,
    };
  };
}

/**
 * Wrap expiring static credentials in a provider that re-queries the plugin once they expire.
 *
 * @param sourceName - name of the credential provider source that produced the value, used in error messages
 * @param current - the credentials obtained during initial resolution
 * @param producer - function that queries the plugin for a credential value
 */
function refreshFromPluginProvider(
  sourceName: string,
  current: SDKv3CompatibleCredentials,
  producer: () => Promise<PluginProviderResult>,
): SDKv3CompatibleCredentialProvider {
  return async () => {
    if (credentialsAboutToExpire(current)) {
      const newCreds = await producer();
      if (!isV3Credentials(newCreds)) {
        // Type only, never the value itself: it may hold credentials that reach stderr.
        throw new AuthenticationError('PluginCredentialTypeMismatch', `Plugin initially returned static V3 credentials but now returned something else: credential provider source '${sourceName}' returned a value of type '${describeValueType(newCreds)}' when refreshing expired credentials. The value is not shown because it may contain credentials. A plugin must return the same credential shape on refresh as it did initially, here SDKv3 credentials (an object with a non-empty 'accessKeyId').`);
      }
      current = newCreds;
    }
    return current;
  };
}

function isV3Provider(x: PluginProviderResult): x is SDKv3CompatibleCredentialProvider {
  return typeof x === 'function';
}

function isV2Credentials(x: PluginProviderResult): x is SDKv2CompatibleCredentials {
  return !!(x && typeof x === 'object' && (x as SDKv2CompatibleCredentials).getPromise);
}

function isV3Credentials(x: PluginProviderResult): x is SDKv3CompatibleCredentials {
  return !!(x && typeof x === 'object' && x.accessKeyId && !isV2Credentials(x));
}
