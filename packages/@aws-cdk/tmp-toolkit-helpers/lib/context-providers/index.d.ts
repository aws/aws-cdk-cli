import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import type { SdkProvider } from '../api/aws-auth';
import type { Context } from '../api/context';
import type { IoHelper } from '../api/io/private';
import type { PluginHost, ContextProviderPlugin } from '../api/plugin';
type ContextProviderFactory = ((sdk: SdkProvider, io: IContextProviderMessages) => ContextProviderPlugin);
export interface IContextProviderMessages {
    /**
     * A message that is presented to users in normal mode of operation.
     *
     * Should be used sparingly. The Context Provider framework already provides useful output by default.
     * This can be uses in exceptionally situations, e.g. if a lookup call is expected to take a long time.
     */
    info(message: string): Promise<void>;
    /**
     * A message that helps users debugging the context provider.
     *
     * Should be used in most cases to note on current action.
     */
    debug(message: string): Promise<void>;
}
/**
 * Iterate over the list of missing context values and invoke the appropriate providers from the map to retrieve them
 */
export declare function provideContextValues(missingValues: cxschema.MissingContext[], context: Context, sdk: SdkProvider, pluginHost: PluginHost, ioHelper: IoHelper): Promise<void>;
/**
 * Register a context provider
 *
 * A context provider cannot reuse the SDKs authentication mechanisms.
 */
export declare function registerContextProvider(name: string, provider: ContextProviderPlugin): void;
/**
 * Register a plugin context provider
 *
 * A plugin provider cannot reuse the SDKs authentication mechanisms.
 */
export declare function registerPluginContextProvider(name: string, provider: ContextProviderPlugin): void;
/**
 * Register a context provider factory
 *
 * A context provider factory takes an SdkProvider and returns the context provider plugin.
 */
export declare function registerContextProviderFactory(name: string, provider: ContextProviderFactory): void;
export {};
