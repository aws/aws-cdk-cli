/**
 * Information needed to access an IAM role created
 * as part of the bootstrap process
 */
export interface BootstrapRole {
  /**
   * The ARN of the IAM role created as part of bootrapping
   * e.g. lookupRoleArn
   */
  readonly arn: string;

  /**
   * External ID to use when assuming the bootstrap role
   *
   * @default - No external ID
   */
  readonly assumeRoleExternalId?: string;

  /**
   * Additional options to pass to STS when assuming the role.
   *
   * - `RoleArn` should not be used. Use the dedicated `arn` property instead.
   * - `ExternalId` should not be used. Use the dedicated `assumeRoleExternalId` instead.
   *
   * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/STS.html#assumeRole-property
   * @default - No additional options.
   */
  readonly assumeRoleAdditionalOptions?: { [key: string]: any };

  /**
   * Version of bootstrap stack required to use this role
   *
   * @default - No bootstrap stack required
   */
  readonly requiresBootstrapStackVersion?: number;

  /**
   * Name of SSM parameter with bootstrap stack version
   *
   * @default - Discover SSM parameter by reading stack
   */
  readonly bootstrapStackVersionSsmParameter?: string;
}

/**
 * Artifact properties for CloudFormation stacks.
 */
export interface AwsCloudFormationStackProperties {
  /**
   * A file relative to the assembly root which contains the CloudFormation template for this stack.
   */
  readonly templateFile: string;

  /**
   * Values for CloudFormation stack parameters that should be passed when the stack is deployed.
   *
   * @default - No parameters
   */
  readonly parameters?: { [id: string]: string };

  /**
   * Values for CloudFormation stack tags that should be passed when the stack is deployed.
   *
   * @default - No tags
   */
  readonly tags?: { [id: string]: string };

  /**
   * SNS Notification ARNs that should receive CloudFormation Stack Events.
   *
   * @default - No notification arns
   */
  readonly notificationArns?: string[];

  /**
   * The name to use for the CloudFormation stack.
   * @default - name derived from artifact ID
   */
  readonly stackName?: string;

  /**
   * Whether to enable termination protection for this stack.
   *
   * @default false
   */
  readonly terminationProtection?: boolean;

  /**
   * The role that needs to be assumed to deploy the stack
   *
   * @default - No role is assumed (current credentials are used)
   */
  readonly assumeRoleArn?: string;

  /**
   * External ID to use when assuming role for cloudformation deployments
   *
   * @default - No external ID
   */
  readonly assumeRoleExternalId?: string;

  /**
   * Additional options to pass to STS when assuming the role.
   *
   * - `RoleArn` should not be used. Use the dedicated `assumeRoleArn` property instead.
   * - `ExternalId` should not be used. Use the dedicated `assumeRoleExternalId` instead.
   *
   * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/STS.html#assumeRole-property
   * @default - No additional options.
   */
  readonly assumeRoleAdditionalOptions?: { [key: string]: any };

  /**
   * The role that is passed to CloudFormation to execute the change set
   *
   * @default - No role is passed (currently assumed role/credentials are used)
   */
  readonly cloudFormationExecutionRoleArn?: string;

  /**
   * The role to use to look up values from the target AWS account
   *
   * @default - No role is assumed (current credentials are used)
   */
  readonly lookupRole?: BootstrapRole;

  /**
   * If the stack template has already been included in the asset manifest, its asset URL
   *
   * @default - Not uploaded yet, upload just before deploying
   */
  readonly stackTemplateAssetObjectUrl?: string;

  /**
   * Version of bootstrap stack required to deploy this stack
   *
   * @default - No bootstrap stack required
   */
  readonly requiresBootstrapStackVersion?: number;

  /**
   * SSM parameter where the bootstrap stack version number can be found
   *
   * Only used if `requiresBootstrapStackVersion` is set.
   *
   * - If this value is not set, the bootstrap stack name must be known at
   *   deployment time so the stack version can be looked up from the stack
   *   outputs.
   * - If this value is set, the bootstrap stack can have any name because
   *   we won't need to look it up.
   *
   * @default - Bootstrap stack version number looked up
   */
  readonly bootstrapStackVersionSsmParameter?: string;

  /**
   * Whether this stack should be validated by the CLI after synthesis
   *
   * @default - false
   */
  readonly validateOnSynth?: boolean;
}

/**
 * Configuration options for the Asset Manifest
 */
export interface AssetManifestOptions {
  /**
   * Version of bootstrap stack required to deploy this stack
   *
   * @default - Version 1 (basic modern bootstrap stack)
   */
  readonly requiresBootstrapStackVersion?: number;

  /**
   * SSM parameter where the bootstrap stack version number can be found
   *
   * - If this value is not set, the bootstrap stack name must be known at
   *   deployment time so the stack version can be looked up from the stack
   *   outputs.
   * - If this value is set, the bootstrap stack can have any name because
   *   we won't need to look it up.
   *
   * @default - Bootstrap stack version number looked up
   */
  readonly bootstrapStackVersionSsmParameter?: string;
}

/**
 * Artifact properties for the Asset Manifest
 */
export interface AssetManifestProperties extends AssetManifestOptions {
  /**
   * Filename of the asset manifest
   */
  readonly file: string;
}

/**
 * Artifact properties for the Construct Tree Artifact
 */
export interface TreeArtifactProperties {
  /**
   * Filename of the tree artifact
   */
  readonly file: string;
}

/**
 * Artifact properties for nested cloud assemblies
 */
export interface NestedCloudAssemblyProperties {
  /**
   * Relative path to the nested cloud assembly
   */
  readonly directoryName: string;

  /**
   * Display name for the cloud assembly
   *
   * @default - The artifact ID
   */
  readonly displayName?: string;
}

/**
 * Artifact properties for a feature flag report
 *
 * A feature flag report is small enough that all the properties can be inlined
 * here, and doesn't need an additional file.
 */
export interface FeatureFlagReportProperties {
  /**
   * The library that this feature flag report applies to.
   */
  readonly libraryName: string;

  /**
   * Information about every feature flag supported by this library.
   */
  readonly flags: Record<string, FeatureFlag>;
}

/**
 * A single feature flag
 */
export interface FeatureFlag {
  /**
   * The library-recommended value for this flag, if any
   *
   * It is possible that there is no recommended value.
   *
   * @default - No recommended value.
   */
  readonly recommendedValue?: any;

  /**
   * The value configured by the user
   *
   * This is the value configured at the root of the tree. Users may also have
   * configured values at specific locations in the tree; we don't report on
   * those.
   *
   * @default - Not configured by the user
   */
  readonly userValue?: any;

  /**
   * Explanation about the purpose of this flag that can be shown to the user.
   *
   * @default - No description
   */
  readonly explanation?: string;
}

/**
 * Properties for manifest artifacts
 */
export type ArtifactProperties =
  | AwsCloudFormationStackProperties
  | AssetManifestProperties
  | TreeArtifactProperties
  | NestedCloudAssemblyProperties
  | FeatureFlagReportProperties;
