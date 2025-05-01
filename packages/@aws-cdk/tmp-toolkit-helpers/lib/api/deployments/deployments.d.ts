import type * as cxapi from '@aws-cdk/cx-api';
import * as cdk_assets from 'cdk-assets';
import type { DeploymentMethod } from './deployment-method';
import type { DeployStackResult } from './deployment-result';
import type { SdkProvider } from '../aws-auth';
import type { Template, RootTemplateWithNestedStacks } from '../cloudformation';
import { EnvironmentAccess } from '../environment';
import type { HotswapMode, HotswapPropertyOverrides } from '../hotswap/common';
import { type IoHelper } from '../io/private';
import type { ResourceIdentifierSummaries, ResourcesToImport } from '../resource-import';
import type { Tag } from '../tags';
export interface DeployStackOptions {
    /**
     * Stack to deploy
     */
    readonly stack: cxapi.CloudFormationStackArtifact;
    /**
     * Execution role for the deployment (pass through to CloudFormation)
     *
     * @default - Current role
     */
    readonly roleArn?: string;
    /**
     * Topic ARNs to send a message when deployment finishes (pass through to CloudFormation)
     *
     * @default - No notifications
     */
    readonly notificationArns?: string[];
    /**
     * Override name under which stack will be deployed
     *
     * @default - Use artifact default
     */
    readonly deployName?: string;
    /**
     * Name of the toolkit stack, if not the default name
     *
     * @default 'CDKToolkit'
     */
    readonly toolkitStackName?: string;
    /**
     * List of asset IDs which should NOT be built or uploaded
     *
     * @default - Build all assets
     */
    readonly reuseAssets?: string[];
    /**
     * Stack tags (pass through to CloudFormation)
     */
    readonly tags?: Tag[];
    /**
     * Stage the change set but don't execute it
     *
     * @default - true
     * @deprecated Use 'deploymentMethod' instead
     */
    readonly execute?: boolean;
    /**
     * Optional name to use for the CloudFormation change set.
     * If not provided, a name will be generated automatically.
     *
     * @deprecated Use 'deploymentMethod' instead
     */
    readonly changeSetName?: string;
    /**
     * Select the deployment method (direct or using a change set)
     *
     * @default - Change set with default options
     */
    readonly deploymentMethod?: DeploymentMethod;
    /**
     * Force deployment, even if the deployed template is identical to the one we are about to deploy.
     * @default false deployment will be skipped if the template is identical
     */
    readonly forceDeployment?: boolean;
    /**
     * Extra parameters for CloudFormation
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
     * @default true
     */
    readonly usePreviousParameters?: boolean;
    /**
     * Rollback failed deployments
     *
     * @default true
     */
    readonly rollback?: boolean;
    readonly hotswap?: HotswapMode;
    /**
     * Properties that configure hotswap behavior
     */
    readonly hotswapPropertyOverrides?: HotswapPropertyOverrides;
    /**
     * The extra string to append to the User-Agent header when performing AWS SDK calls.
     *
     * @default - nothing extra is appended to the User-Agent header
     */
    readonly extraUserAgent?: string;
    /**
     * List of existing resources to be IMPORTED into the stack, instead of being CREATED
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
    /**
     * Whether to deploy if the app contains no stacks.
     *
     * @deprecated this option seems to be unsed inside deployments
     * @default false
     */
    readonly ignoreNoStacks?: boolean;
}
export interface RollbackStackOptions {
    /**
     * Stack to roll back
     */
    readonly stack: cxapi.CloudFormationStackArtifact;
    /**
     * Execution role for the deployment (pass through to CloudFormation)
     *
     * @default - Current role
     */
    readonly roleArn?: string;
    /**
     * Name of the toolkit stack, if not the default name
     *
     * @default 'CDKToolkit'
     */
    readonly toolkitStackName?: string;
    /**
     * Whether to automatically orphan all failed resources during the rollback
     *
     * This will force a rollback that otherwise would have failed.
     *
     * @default false
     */
    readonly orphanFailedResources?: boolean;
    /**
     * Orphan the resources with the given logical IDs
     *
     * @default - No orphaning
     */
    readonly orphanLogicalIds?: string[];
    /**
     * Whether to validate the version of the bootstrap stack permissions
     *
     * @default true
     */
    readonly validateBootstrapStackVersion?: boolean;
}
export type RollbackStackResult = {
    readonly stackArn: string;
} & ({
    readonly notInRollbackableState: true;
} | {
    readonly success: true;
    notInRollbackableState?: undefined;
});
interface AssetOptions {
    /**
     * Stack with assets to build.
     */
    readonly stack: cxapi.CloudFormationStackArtifact;
    /**
     * Execution role for the building.
     *
     * @default - Current role
     */
    readonly roleArn?: string;
}
export interface BuildStackAssetsOptions extends AssetOptions {
    /**
     * Stack name this asset is for
     */
    readonly stackName?: string;
}
interface PublishStackAssetsOptions extends AssetOptions {
    /**
     * Stack name this asset is for
     */
    readonly stackName?: string;
    /**
     * Always publish, even if it already exists
     *
     * @default false
     */
    readonly forcePublish?: boolean;
}
export interface DestroyStackOptions {
    stack: cxapi.CloudFormationStackArtifact;
    deployName?: string;
    roleArn?: string;
}
export interface StackExistsOptions {
    stack: cxapi.CloudFormationStackArtifact;
    deployName?: string;
    tryLookupRole?: boolean;
}
export interface DeploymentsProps {
    readonly sdkProvider: SdkProvider;
    readonly toolkitStackName?: string;
    readonly ioHelper: IoHelper;
}
/**
 * Scope for a single set of deployments from a set of Cloud Assembly Artifacts
 *
 * Manages lookup of SDKs, Bootstrap stacks, etc.
 */
export declare class Deployments {
    private readonly props;
    readonly envs: EnvironmentAccess;
    /**
     * SDK provider for asset publishing (do not use for anything else).
     *
     * This SDK provider is only allowed to be used for that purpose, nothing else.
     *
     * It's not a different object, but the field name should imply that this
     * object should not be used directly, except to pass to asset handling routines.
     */
    private readonly assetSdkProvider;
    /**
     * SDK provider for passing to deployStack
     *
     * This SDK provider is only allowed to be used for that purpose, nothing else.
     *
     * It's not a different object, but the field name should imply that this
     * object should not be used directly, except to pass to `deployStack`.
     */
    private readonly deployStackSdkProvider;
    private readonly publisherCache;
    private _allowCrossAccountAssetPublishing;
    private readonly ioHelper;
    constructor(props: DeploymentsProps);
    /**
     * Resolves the environment for a stack.
     */
    resolveEnvironment(stack: cxapi.CloudFormationStackArtifact): Promise<cxapi.Environment>;
    readCurrentTemplateWithNestedStacks(rootStackArtifact: cxapi.CloudFormationStackArtifact, retrieveProcessedTemplate?: boolean): Promise<RootTemplateWithNestedStacks>;
    readCurrentTemplate(stackArtifact: cxapi.CloudFormationStackArtifact): Promise<Template>;
    resourceIdentifierSummaries(stackArtifact: cxapi.CloudFormationStackArtifact): Promise<ResourceIdentifierSummaries>;
    deployStack(options: DeployStackOptions): Promise<DeployStackResult>;
    rollbackStack(options: RollbackStackOptions): Promise<RollbackStackResult>;
    destroyStack(options: DestroyStackOptions): Promise<import("./deploy-stack").DestroyStackResult>;
    stackExists(options: StackExistsOptions): Promise<boolean>;
    /**
     * Build a single asset from an asset manifest
     *
     * If an assert manifest artifact is given, the bootstrap stack version
     * will be validated according to the constraints in that manifest artifact.
     * If that is not necessary, `'no-version-validation'` can be passed.
     */
    buildSingleAsset(assetArtifact: cxapi.AssetManifestArtifact | 'no-version-validation', assetManifest: cdk_assets.AssetManifest, asset: cdk_assets.IManifestEntry, options: BuildStackAssetsOptions): Promise<void>;
    /**
     * Publish a single asset from an asset manifest
     */
    publishSingleAsset(assetManifest: cdk_assets.AssetManifest, asset: cdk_assets.IManifestEntry, options: PublishStackAssetsOptions): Promise<void>;
    private allowCrossAccountAssetPublishingForEnv;
    /**
     * Return whether a single asset has been published already
     */
    isSingleAssetPublished(assetManifest: cdk_assets.AssetManifest, asset: cdk_assets.IManifestEntry, options: PublishStackAssetsOptions): Promise<boolean>;
    /**
     * Validate that the bootstrap stack has the right version for this stack
     *
     * Call into envResources.validateVersion, but prepend the stack name in case of failure.
     */
    private validateBootstrapStackVersion;
    private cachedPublisher;
}
export {};
