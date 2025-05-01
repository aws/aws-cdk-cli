import type { CredentialProviderSource, IPluginHost } from '@aws-cdk/cli-plugin-contract';
import { type ContextProviderPlugin } from './context-provider-plugin';
import type { IIoHost } from '../io';
export declare let TESTING: boolean;
export declare function markTesting(): void;
/**
 * Class to manage a plugin collection
 *
 * It provides a `load()` function that loads a JavaScript
 * module from disk, and gives it access to the `IPluginHost` interface
 * to register itself.
 */
export declare class PluginHost implements IPluginHost {
    /**
     * Access the currently registered CredentialProviderSources. New sources can
     * be registered using the +registerCredentialProviderSource+ method.
     */
    readonly credentialProviderSources: CredentialProviderSource[];
    readonly contextProviderPlugins: Record<string, ContextProviderPlugin>;
    ioHost?: IIoHost;
    private readonly alreadyLoaded;
    /**
     * Loads a plug-in into this PluginHost.
     *
     * Will use `require.resolve()` to get the most accurate representation of what
     * code will get loaded in error messages. As such, it will not work in
     * unit tests with Jest virtual modules becauase of <https://github.com/jestjs/jest/issues/9543>.
     *
     * @param moduleSpec the specification (path or name) of the plug-in module to be loaded.
     * @param ioHost the I/O host to use for printing progress information
     */
    load(moduleSpec: string, ioHost?: IIoHost): void;
    /**
     * Do the loading given an already-resolved module name
     *
     * @internal
     */
    _doLoad(resolved: string): void;
    /**
     * Allows plug-ins to register new CredentialProviderSources.
     *
     * @param source a new CredentialProviderSource to register.
     */
    registerCredentialProviderSource(source: CredentialProviderSource): void;
    /**
     * (EXPERIMENTAL) Allow plugins to register context providers
     *
     * Context providers are objects with the following method:
     *
     * ```ts
     *   getValue(args: {[key: string]: any}): Promise<any>;
     * ```
     *
     * Currently, they cannot reuse the CDK's authentication mechanisms, so they
     * must be prepared to either not make AWS calls or use their own source of
     * AWS credentials.
     *
     * This feature is experimental, and only intended to be used internally at Amazon
     * as a trial.
     *
     * After registering with 'my-plugin-name', the provider must be addressed as follows:
     *
     * ```ts
     * const value = ContextProvider.getValue(this, {
     *   providerName: 'plugin',
     *   props: {
     *     pluginName: 'my-plugin-name',
     *     myParameter1: 'xyz',
     *   },
     *   includeEnvironment: true | false,
     *   dummyValue: 'what-to-return-on-the-first-pass',
     * })
     * ```
     *
     * @experimental
     */
    registerContextProviderAlpha(pluginProviderName: string, provider: ContextProviderPlugin): void;
}
