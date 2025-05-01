import type { Environment } from '@aws-cdk/cx-api';
import type { SDK } from '../aws-auth';
import { type IoHelper } from '../io/private';
import { type EcrRepositoryInfo, ToolkitInfo } from '../toolkit-info';
/**
 * Registry class for `EnvironmentResources`.
 *
 * The state management of this class is a bit non-standard. We want to cache
 * data related to toolkit stacks and SSM parameters, but we are not in charge
 * of ensuring caching of SDKs. Since `EnvironmentResources` needs an SDK to
 * function, we treat it as an ephemeral class, and store the actual cached data
 * in `EnvironmentResourcesRegistry`.
 */
export declare class EnvironmentResourcesRegistry {
    private readonly toolkitStackName?;
    private readonly cache;
    constructor(toolkitStackName?: string | undefined);
    for(resolvedEnvironment: Environment, sdk: SDK, ioHelper: IoHelper): EnvironmentResources;
}
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
export declare class EnvironmentResources {
    readonly environment: Environment;
    private readonly sdk;
    private readonly ioHelper;
    private readonly cache;
    private readonly toolkitStackName?;
    constructor(environment: Environment, sdk: SDK, ioHelper: IoHelper, cache: EnvironmentCache, toolkitStackName?: string | undefined);
    /**
     * Look up the toolkit for a given environment, using a given SDK
     */
    lookupToolkit(): Promise<ToolkitInfo>;
    /**
     * Validate that the bootstrap stack version matches or exceeds the expected version
     *
     * Use the SSM parameter name to read the version number if given, otherwise use the version
     * discovered on the bootstrap stack.
     *
     * Pass in the SSM parameter name so we can cache the lookups an don't need to do the same
     * lookup again and again for every artifact.
     */
    validateVersion(expectedVersion: number | undefined, ssmParameterName: string | undefined): Promise<void>;
    /**
     * Read a version from an SSM parameter, cached
     */
    versionFromSsmParameter(parameterName: string): Promise<number>;
    prepareEcrRepository(repositoryName: string): Promise<EcrRepositoryInfo>;
}
export declare class NoBootstrapStackEnvironmentResources extends EnvironmentResources {
    constructor(environment: Environment, sdk: SDK, ioHelper: IoHelper);
    /**
     * Look up the toolkit for a given environment, using a given SDK
     */
    lookupToolkit(): Promise<ToolkitInfo>;
}
/**
 * Data that is cached on a per-environment level
 *
 * This cache may be shared between different instances of the `EnvironmentResources` class.
 */
interface EnvironmentCache {
    readonly ssmParameters: Map<string, number>;
    toolkitInfo?: ToolkitInfo;
}
export {};
