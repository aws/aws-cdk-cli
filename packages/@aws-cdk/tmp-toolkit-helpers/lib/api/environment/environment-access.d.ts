import type * as cxapi from '@aws-cdk/cx-api';
import type { EnvironmentResources } from './environment-resources';
import type { StringWithoutPlaceholders } from './placeholders';
import type { SDK, SdkProvider } from '../aws-auth';
import { type IoHelper } from '../io/private';
/**
 * Access particular AWS resources, based on information from the CX manifest
 *
 * It is not possible to grab direct access to AWS credentials; 9 times out of 10
 * we have to allow for role assumption, and role assumption can only work if
 * there is a CX Manifest that contains a role ARN.
 *
 * This class exists so new code isn't tempted to go and get SDK credentials directly.
 */
export declare class EnvironmentAccess {
    private readonly sdkProvider;
    private readonly sdkCache;
    private readonly environmentResources;
    private readonly ioHelper;
    constructor(sdkProvider: SdkProvider, toolkitStackName: string, ioHelper: IoHelper);
    /**
     * Resolves the environment for a stack.
     */
    resolveStackEnvironment(stack: cxapi.CloudFormationStackArtifact): Promise<cxapi.Environment>;
    /**
     * Get an SDK to access the given stack's environment for stack operations
     *
     * Will ask plugins for readonly credentials if available, use the default
     * AWS credentials if not.
     *
     * Will assume the deploy role if configured on the stack. Check the default `deploy-role`
     * policies to see what you can do with this role.
     */
    accessStackForReadOnlyStackOperations(stack: cxapi.CloudFormationStackArtifact): Promise<TargetEnvironment>;
    /**
     * Get an SDK to access the given stack's environment for stack operations
     *
     * Will ask plugins for mutating credentials if available, use the default AWS
     * credentials if not.  The `mode` parameter is only used for querying
     * plugins.
     *
     * Will assume the deploy role if configured on the stack. Check the default `deploy-role`
     * policies to see what you can do with this role.
     */
    accessStackForMutableStackOperations(stack: cxapi.CloudFormationStackArtifact): Promise<TargetEnvironment>;
    /**
     * Get an SDK to access the given stack's environment for environmental lookups
     *
     * Will use a plugin if available, use the default AWS credentials if not.
     * The `mode` parameter is only used for querying plugins.
     *
     * Will assume the lookup role if configured on the stack. Check the default `lookup-role`
     * policies to see what you can do with this role. It can generally read everything
     * in the account that does not require KMS access.
     *
     * ---
     *
     * For backwards compatibility reasons, there are some scenarios that are handled here:
     *
     *  1. The lookup role may not exist (it was added in bootstrap stack version 7). If so:
     *     a. Return the default credentials if the default credentials are for the stack account
     *        (you will notice this as `isFallbackCredentials=true`).
     *     b. Throw an error if the default credentials are not for the stack account.
     *
     *  2. The lookup role may not have the correct permissions (for example, ReadOnlyAccess was added in
     *     bootstrap stack version 8); the stack will have a minimum version number on it.
     *     a. If it does not we throw an error which should be handled in the calling
     *        function (and fallback to use a different role, etc)
     *
     * Upon success, caller will have an SDK for the right account, which may or may not have
     * the right permissions.
     */
    accessStackForLookup(stack: cxapi.CloudFormationStackArtifact): Promise<TargetEnvironment>;
    /**
     * Get an SDK to access the given stack's environment for reading stack attributes
     *
     * Will use a plugin if available, use the default AWS credentials if not.
     * The `mode` parameter is only used for querying plugins.
     *
     * Will try to assume the lookup role if given, will use the regular stack operations
     * access (deploy-role) otherwise. When calling this, you should assume that you will get
     * the least privileged role, so don't try to use it for anything the `deploy-role`
     * wouldn't be able to do. Also you cannot rely on being able to read encrypted anything.
     */
    accessStackForLookupBestEffort(stack: cxapi.CloudFormationStackArtifact): Promise<TargetEnvironment>;
    /**
     * Get an SDK to access the given stack's environment for stack operations
     *
     * Will use a plugin if available, use the default AWS credentials if not.
     * The `mode` parameter is only used for querying plugins.
     *
     * Will assume the deploy role if configured on the stack. Check the default `deploy-role`
     * policies to see what you can do with this role.
     */
    private accessStackForStackOperations;
    /**
     * Prepare an SDK for use in the given environment and optionally with a role assumed.
     */
    private prepareSdk;
    private cachedSdkForEnvironment;
}
/**
 * SDK obtained by assuming the deploy role
 * for a given environment
 */
export interface TargetEnvironment {
    /**
     * The SDK for the given environment
     */
    readonly sdk: SDK;
    /**
     * The resolved environment for the stack
     * (no more 'unknown-account/unknown-region')
     */
    readonly resolvedEnvironment: cxapi.Environment;
    /**
     * Access class for environmental resources to help the deployment
     */
    readonly resources: EnvironmentResources;
    /**
     * Whether or not we assumed a role in the process of getting these credentials
     */
    readonly didAssumeRole: boolean;
    /**
     * Whether or not these are fallback credentials
     *
     * Fallback credentials means that assuming the intended role failed, but the
     * base credentials happen to be for the right account so we just picked those
     * and hope the future SDK calls succeed.
     *
     * This is a backwards compatibility mechanism from around the time we introduced
     * deployment roles.
     */
    readonly isFallbackCredentials: boolean;
    /**
     * Replace environment placeholders according to the current environment
     */
    replacePlaceholders(x: string | undefined): Promise<StringWithoutPlaceholders | undefined>;
}
