import type * as cxapi from '@aws-cdk/cx-api';
import type { Tag } from '@aws-sdk/client-cloudformation';
import type { DeploymentMethod } from './deployment-method';
import type { DeployStackResult } from './deployment-result';
import type { SDK, SdkProvider } from '../aws-auth';
import type { EnvironmentResources, StringWithoutPlaceholders } from '../environment';
import { HotswapMode, HotswapPropertyOverrides } from '../hotswap/common';
import { type IoHelper } from '../io/private';
import type { ResourcesToImport } from '../resource-import';
export interface DeployStackOptions {
    /**
     * The stack to be deployed
     */
    readonly stack: cxapi.CloudFormationStackArtifact;
    /**
     * The environment to deploy this stack in
     *
     * The environment on the stack artifact may be unresolved, this one
     * must be resolved.
     */
    readonly resolvedEnvironment: cxapi.Environment;
    /**
     * The SDK to use for deploying the stack
     *
     * Should have been initialized with the correct role with which
     * stack operations should be performed.
     */
    readonly sdk: SDK;
    /**
     * SDK provider (seeded with default credentials)
     *
     * Will be used to:
     *
     * - Publish assets, either legacy assets or large CFN templates
     *   that aren't themselves assets from a manifest. (Needs an SDK
     *   Provider because the file publishing role is declared as part
     *   of the asset).
     * - Hotswap
     */
    readonly sdkProvider: SdkProvider;
    /**
     * Information about the bootstrap stack found in the target environment
     */
    readonly envResources: EnvironmentResources;
    /**
     * Role to pass to CloudFormation to execute the change set
     *
     * To obtain a `StringWithoutPlaceholders`, run a regular
     * string though `TargetEnvironment.replacePlaceholders`.
     *
     * @default - No execution role; CloudFormation either uses the role currently associated with
     * the stack, or otherwise uses current AWS credentials.
     */
    readonly roleArn?: StringWithoutPlaceholders;
    /**
     * Notification ARNs to pass to CloudFormation to notify when the change set has completed
     *
     * @default - No notifications
     */
    readonly notificationArns?: string[];
    /**
     * Name to deploy the stack under
     *
     * @default - Name from assembly
     */
    readonly deployName?: string;
    /**
     * List of asset IDs which shouldn't be built
     *
     * @default - Build all assets
     */
    readonly reuseAssets?: string[];
    /**
     * Tags to pass to CloudFormation to add to stack
     *
     * @default - No tags
     */
    readonly tags?: Tag[];
    /**
     * What deployment method to use
     *
     * @default - Change set with defaults
     */
    readonly deploymentMethod?: DeploymentMethod;
    /**
     * The collection of extra parameters
     * (in addition to those used for assets)
     * to pass to the deployed template.
     * Note that parameters with `undefined` or empty values will be ignored,
     * and not passed to the template.
     *
     * @default - no additional parameters will be passed to the template
     */
    readonly parameters?: {
        [name: string]: string | undefined;
    };
    /**
     * Use previous values for unspecified parameters
     *
     * If not set, all parameters must be specified for every deployment.
     *
     * @default false
     */
    readonly usePreviousParameters?: boolean;
    /**
     * Deploy even if the deployed template is identical to the one we are about to deploy.
     * @default false
     */
    readonly forceDeployment?: boolean;
    /**
     * Rollback failed deployments
     *
     * @default true
     */
    readonly rollback?: boolean;
    readonly hotswap?: HotswapMode;
    /**
     * Extra properties that configure hotswap behavior
     */
    readonly hotswapPropertyOverrides?: HotswapPropertyOverrides;
    /**
     * The extra string to append to the User-Agent header when performing AWS SDK calls.
     *
     * @default - nothing extra is appended to the User-Agent header
     */
    readonly extraUserAgent?: string;
    /**
     * If set, change set of type IMPORT will be created, and resourcesToImport
     * passed to it.
     */
    readonly resourcesToImport?: ResourcesToImport;
    /**
     * If present, use this given template instead of the stored one
     *
     * @default - Use the stored template
     */
    readonly overrideTemplate?: any;
    /**
     * Whether to build/publish assets in parallel
     *
     * @default true To remain backward compatible.
     */
    readonly assetParallelism?: boolean;
}
export declare function deployStack(options: DeployStackOptions, ioHelper: IoHelper): Promise<DeployStackResult>;
export interface DestroyStackOptions {
    /**
     * The stack to be destroyed
     */
    stack: cxapi.CloudFormationStackArtifact;
    sdk: SDK;
    roleArn?: string;
    deployName?: string;
}
export interface DestroyStackResult {
    /**
     * The ARN of the stack that was destroyed, if any.
     *
     * If the stack didn't exist to begin with, the operation will succeed
     * but this value will be undefined.
     */
    readonly stackArn?: string;
}
export declare function destroyStack(options: DestroyStackOptions, ioHelper: IoHelper): Promise<DestroyStackResult>;
