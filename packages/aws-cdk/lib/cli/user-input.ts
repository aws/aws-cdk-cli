// -------------------------------------------------------------------------------------------
// GENERATED FROM packages/aws-cdk/lib/cli/cli-config.ts.
// Do not edit by hand; all changes will be overwritten at build time from the config file.
// -------------------------------------------------------------------------------------------
/* eslint-disable @stylistic/max-len, @typescript-eslint/consistent-type-imports */
import { Command } from './user-configuration';

/**
 * The structure of the user input -- either CLI options or cdk.json -- generated from packages/aws-cdk/lib/config.ts
 *
 * @struct
 */
export interface UserInput {
  /**
   * The CLI command name
   */
  readonly command?: Command;

  /**
   * Global options available to all CLI commands
   */
  readonly globalOptions?: GlobalOptions;

  /**
   * Lists all stacks in the app
   *
   * aliases: ls
   */
  readonly list?: ListOptions;

  /**
   * Synthesizes and prints the CloudFormation template for this stack
   *
   * aliases: synthesize
   */
  readonly synth?: SynthOptions;

  /**
   * Deploys the CDK toolkit stack into an AWS environment
   */
  readonly bootstrap?: BootstrapOptions;

  /**
   * Garbage collect assets. Options detailed here: https://github.com/aws/aws-cdk-cli/tree/main/packages/aws-cdk#cdk-gc
   */
  readonly gc?: GcOptions;

  /**
   * View and toggle feature flags.
   */
  readonly flags?: FlagsOptions;

  /**
   * Deploys the stack(s) named STACKS into your AWS account
   */
  readonly deploy?: DeployOptions;

  /**
   * Rolls back the stack(s) named STACKS to their last stable state
   */
  readonly rollback?: RollbackOptions;

  /**
   * Import existing resource(s) into the given STACK
   */
  readonly import?: ImportOptions;

  /**
   * Shortcut for 'deploy --watch'
   */
  readonly watch?: WatchOptions;

  /**
   * Destroy the stack(s) named STACKS
   */
  readonly destroy?: DestroyOptions;

  /**
   * Compares the specified stack with the deployed stack or a local template file, and returns with status 1 if any difference is found
   */
  readonly diff?: DiffOptions;

  /**
   * Detect drifts in the given CloudFormation stack(s)
   */
  readonly drift?: DriftOptions;

  /**
   * Returns all metadata associated with this stack
   */
  readonly metadata?: MetadataOptions;

  /**
   * Acknowledge a notice so that it does not show up anymore
   *
   * aliases: ack
   */
  readonly acknowledge?: AcknowledgeOptions;

  /**
   * Returns a list of relevant notices
   */
  readonly notices?: NoticesOptions;

  /**
   * Create a new, empty CDK project from a template.
   */
  readonly init?: InitOptions;

  /**
   * Migrate existing AWS resources into a CDK app
   */
  readonly migrate?: MigrateOptions;

  /**
   * Manage cached context values
   */
  readonly context?: ContextOptions;

  /**
   * Opens the reference documentation in a browser
   *
   * aliases: doc
   */
  readonly docs?: DocsOptions;

  /**
   * Check your set-up for potential problems
   */
  readonly doctor?: {};

  /**
   * Moves resources between stacks or within the same stack
   */
  readonly refactor?: RefactorOptions;

  /**
   * Enable or disable anonymous telemetry
   */
  readonly cliTelemetry?: CliTelemetryOptions;
}

/**
 * Global options available to all CLI commands
 *
 * @struct
 */
export interface GlobalOptions {
  /**
   * REQUIRED WHEN RUNNING APP: command-line for executing your app or a cloud assembly directory (e.g. "node bin/my-app.js"). Can also be specified in cdk.json or ~/.cdk.json
   *
   * @default - undefined
   */
  readonly app?: string;

  /**
   * Command-line for a pre-synth build
   *
   * @default - undefined
   */
  readonly build?: string;

  /**
   * Add contextual string parameter (KEY=VALUE)
   *
   * @default - undefined
   */
  readonly context?: Array<string>;

  /**
   * Name or path of a node package that extend the CDK features. Can be specified multiple times
   *
   * @default - undefined
   */
  readonly plugin?: Array<string>;

  /**
   * Print trace for stack warnings
   *
   * @default - undefined
   */
  readonly trace?: boolean;

  /**
   * Do not construct stacks with warnings
   *
   * @default - undefined
   */
  readonly strict?: boolean;

  /**
   * Perform context lookups (synthesis fails if this is disabled and context lookups need to be performed)
   *
   * @default - true
   */
  readonly lookups?: boolean;

  /**
   * Ignores synthesis errors, which will likely produce an invalid output
   *
   * @default - false
   */
  readonly ignoreErrors?: boolean;

  /**
   * Use JSON output instead of YAML when templates are printed to STDOUT
   *
   * @default - false
   */
  readonly json?: boolean;

  /**
   * Show debug logs (specify multiple times to increase verbosity)
   *
   * @default - false
   */
  readonly verbose?: number;

  /**
   * Debug the CDK app. Log additional information during synthesis, such as creation stack traces of tokens (sets CDK_DEBUG, will slow down synthesis)
   *
   * @default - false
   */
  readonly debug?: boolean;

  /**
   * Use the indicated AWS profile as the default environment
   *
   * @default - undefined
   */
  readonly profile?: string;

  /**
   * Use the indicated proxy. Will read from HTTPS_PROXY environment variable if not specified
   *
   * @default - undefined
   */
  readonly proxy?: string;

  /**
   * Path to CA certificate to use when validating HTTPS requests. Will read from AWS_CA_BUNDLE environment variable if not specified
   *
   * @default - undefined
   */
  readonly caBundlePath?: string;

  /**
   * Force trying to fetch EC2 instance credentials. Default: guess EC2 instance status
   *
   * @default - undefined
   */
  readonly ec2creds?: boolean;

  /**
   * Disable CLI telemetry and do not include the "AWS::CDK::Metadata" resource in synthesized templates (enabled by default)
   *
   * @default - undefined
   */
  readonly versionReporting?: boolean;

  /**
   * Include "aws:cdk:path" CloudFormation metadata for each resource (enabled by default)
   *
   * @default - undefined
   */
  readonly pathMetadata?: boolean;

  /**
   * Include "aws:asset:*" CloudFormation metadata for resources that uses assets (enabled by default)
   *
   * @default - undefined
   */
  readonly assetMetadata?: boolean;

  /**
   * ARN of Role to use when invoking CloudFormation
   *
   * @default - undefined
   */
  readonly roleArn?: string;

  /**
   * Copy assets to the output directory (use --no-staging to disable the copy of assets which allows local debugging via the SAM CLI to reference the original source files)
   *
   * @default - true
   */
  readonly staging?: boolean;

  /**
   * Emits the synthesized cloud assembly into a directory (default: cdk.out)
   *
   * @default - undefined
   */
  readonly output?: string;

  /**
   * Show relevant notices
   *
   * @default - undefined
   */
  readonly notices?: boolean;

  /**
   * Removes colors and other style from console output
   *
   * @default - false
   */
  readonly noColor?: boolean;

  /**
   * Force CI detection. If CI=true then logs will be sent to stdout instead of stderr
   *
   * @default - undefined
   */
  readonly ci?: boolean;

  /**
   * Opt in to unstable features. The flag indicates that the scope and API of a feature might still change. Otherwise the feature is generally production ready and fully supported. Can be specified multiple times.
   *
   * @default - []
   */
  readonly unstable?: Array<string>;

  /**
   * Send telemetry data to a local file.
   *
   * @default - undefined
   */
  readonly telemetryFile?: string;
}

/**
 * Lists all stacks in the app
 *
 * aliases: ls
 *
 * @struct
 */
export interface ListOptions {
  /**
   * Display environment information for each stack
   *
   * aliases: l
   *
   * @default - false
   */
  readonly long?: boolean;

  /**
   * Display stack dependency information for each stack
   *
   * aliases: d
   *
   * @default - false
   */
  readonly showDependencies?: boolean;

  /**
   * Positional argument for list
   */
  readonly STACKS?: Array<string>;
}

/**
 * Synthesizes and prints the CloudFormation template for this stack
 *
 * aliases: synthesize
 *
 * @struct
 */
export interface SynthOptions {
  /**
   * Only synthesize requested stacks, don't include dependencies
   *
   * aliases: e
   *
   * @default - undefined
   */
  readonly exclusively?: boolean;

  /**
   * After synthesis, validate stacks with the "validateOnSynth" attribute set (can also be controlled with CDK_VALIDATION)
   *
   * @default - true
   */
  readonly validation?: boolean;

  /**
   * Do not output CloudFormation Template to stdout
   *
   * aliases: q
   *
   * @default - false
   */
  readonly quiet?: boolean;

  /**
   * Positional argument for synth
   */
  readonly STACKS?: Array<string>;
}

/**
 * Deploys the CDK toolkit stack into an AWS environment
 *
 * @struct
 */
export interface BootstrapOptions {
  /**
   * The name of the CDK toolkit bucket; bucket will be created and must not exist
   *
   * aliases: b toolkit-bucket-name
   *
   * @default - undefined
   */
  readonly bootstrapBucketName?: string;

  /**
   * AWS KMS master key ID used for the SSE-KMS encryption (specify AWS_MANAGED_KEY to use an AWS-managed key)
   *
   * @default - undefined
   */
  readonly bootstrapKmsKeyId?: string;

  /**
   * Use the example permissions boundary.
   *
   * aliases: epb
   *
   * @default - undefined
   */
  readonly examplePermissionsBoundary?: boolean;

  /**
   * Use the permissions boundary specified by name.
   *
   * aliases: cpb
   *
   * @default - undefined
   */
  readonly customPermissionsBoundary?: string;

  /**
   * Create a Customer Master Key (CMK) for the bootstrap bucket (you will be charged but can customize permissions, modern bootstrapping only)
   *
   * @default - undefined
   */
  readonly bootstrapCustomerKey?: boolean;

  /**
   * String which must be unique for each bootstrap stack. You must configure it on your CDK app if you change this from the default.
   *
   * @default - undefined
   */
  readonly qualifier?: string;

  /**
   * Block public access configuration on CDK toolkit bucket (enabled by default)
   *
   * @default - undefined
   */
  readonly publicAccessBlockConfiguration?: boolean;

  /**
   * Tags to add for the stack (KEY=VALUE)
   *
   * aliases: t
   *
   * @default - []
   */
  readonly tags?: Array<string>;

  /**
   * Whether to execute ChangeSet (--no-execute will NOT execute the ChangeSet)
   *
   * @default - true
   */
  readonly execute?: boolean;

  /**
   * The AWS account IDs that should be trusted to perform deployments into this environment (may be repeated, modern bootstrapping only)
   *
   * @default - []
   */
  readonly trust?: Array<string>;

  /**
   * The AWS account IDs that should be trusted to look up values in this environment (may be repeated, modern bootstrapping only)
   *
   * @default - []
   */
  readonly trustForLookup?: Array<string>;

  /**
   * The AWS account IDs that should not be trusted by this environment (may be repeated, modern bootstrapping only)
   *
   * @default - []
   */
  readonly untrust?: Array<string>;

  /**
   * The Managed Policy ARNs that should be attached to the role performing deployments into this environment (may be repeated, modern bootstrapping only)
   *
   * @default - []
   */
  readonly cloudformationExecutionPolicies?: Array<string>;

  /**
   * Always bootstrap even if it would downgrade template version
   *
   * aliases: f
   *
   * @default - false
   */
  readonly force?: boolean;

  /**
   * Toggle CloudFormation termination protection on the bootstrap stacks
   *
   * @default - undefined
   */
  readonly terminationProtection?: boolean;

  /**
   * Instead of actual bootstrapping, print the current CLI's bootstrapping template to stdout for customization
   *
   * @default - false
   */
  readonly showTemplate?: boolean;

  /**
   * The name of the CDK toolkit stack to create
   *
   * @default - undefined
   */
  readonly toolkitStackName?: string;

  /**
   * Use the template from the given file instead of the built-in one (use --show-template to obtain an example)
   *
   * @default - undefined
   */
  readonly template?: string;

  /**
   * Use previous values for existing parameters (you must specify all parameters on every deployment if this is disabled)
   *
   * @default - true
   */
  readonly previousParameters?: boolean;

  /**
   * Positional argument for bootstrap
   */
  readonly ENVIRONMENTS?: Array<string>;
}

/**
 * Garbage collect assets. Options detailed here: https://github.com/aws/aws-cdk-cli/tree/main/packages/aws-cdk#cdk-gc
 *
 * @struct
 */
export interface GcOptions {
  /**
   * The action (or sub-action) you want to perform. Valid entires are "print", "tag", "delete-tagged", "full".
   *
   * @default - "full"
   */
  readonly action?: string;

  /**
   * Specify either ecr, s3, or all
   *
   * @default - "all"
   */
  readonly type?: string;

  /**
   * Delete assets that have been marked as isolated for this many days
   *
   * @default - 0
   */
  readonly rollbackBufferDays?: number;

  /**
   * Never delete assets younger than this (in days)
   *
   * @default - 1
   */
  readonly createdBufferDays?: number;

  /**
   * Confirm via manual prompt before deletion
   *
   * @default - true
   */
  readonly confirm?: boolean;

  /**
   * The name of the CDK toolkit stack, if different from the default "CDKToolkit"
   *
   * @default - undefined
   */
  readonly bootstrapStackName?: string;

  /**
   * Positional argument for gc
   */
  readonly ENVIRONMENTS?: Array<string>;
}

/**
 * View and toggle feature flags.
 *
 * @struct
 */
export interface FlagsOptions {
  /**
   * The value the user would like to set the feature flag configuration to
   *
   * @default - undefined
   */
  readonly value?: string;

  /**
   * Signifies the user would like to modify their feature flag configuration
   *
   * @default - undefined
   */
  readonly set?: boolean;

  /**
   * Modify or view all feature flags
   *
   * @default - undefined
   */
  readonly all?: boolean;

  /**
   * Positional argument for flags
   */
  readonly FLAGNAME?: Array<string>;
}

/**
 * Deploys the stack(s) named STACKS into your AWS account
 *
 * @struct
 */
export interface DeployOptions {
  /**
   * Deploy all available stacks
   *
   * @default - false
   */
  readonly all?: boolean;

  /**
   * Do not rebuild asset with the given ID. Can be specified multiple times
   *
   * aliases: E
   *
   * @default - []
   */
  readonly buildExclude?: Array<string>;

  /**
   * Only deploy requested stacks, don't include dependencies
   *
   * aliases: e
   *
   * @default - undefined
   */
  readonly exclusively?: boolean;

  /**
   * What security-sensitive changes need manual approval
   *
   * @default - undefined
   */
  readonly requireApproval?: string;

  /**
   * ARNs of SNS topics that CloudFormation will notify with stack related events. These will be added to ARNs specified with the 'notificationArns' stack property.
   *
   * @default - undefined
   */
  readonly notificationArns?: Array<string>;

  /**
   * Tags to add to the stack (KEY=VALUE), overrides tags from Cloud Assembly (deprecated)
   *
   * aliases: t
   *
   * @default - undefined
   */
  readonly tags?: Array<string>;

  /**
   * Whether to execute ChangeSet (--no-execute will NOT execute the ChangeSet) (deprecated)
   *
   * @deprecated true
   * @default - undefined
   */
  readonly execute?: boolean;

  /**
   * Name of the CloudFormation change set to create (only if method is not direct)
   *
   * @default - undefined
   */
  readonly changeSetName?: string;

  /**
   * How to perform the deployment. Direct is a bit faster but lacks progress information
   *
   * aliases: m
   *
   * @default - undefined
   */
  readonly method?: string;

  /**
   * Indicates if the stack set imports resources that already exist.
   *
   * @default - false
   */
  readonly importExistingResources?: boolean;

  /**
   * Always deploy stack even if templates are identical
   *
   * aliases: f
   *
   * @default - false
   */
  readonly force?: boolean;

  /**
   * Additional parameters passed to CloudFormation at deploy time (STACK:KEY=VALUE)
   *
   * @default - {}
   */
  readonly parameters?: Array<string>;

  /**
   * Path to file where stack outputs will be written as JSON
   *
   * aliases: O
   *
   * @default - undefined
   */
  readonly outputsFile?: string;

  /**
   * Use previous values for existing parameters (you must specify all parameters on every deployment if this is disabled)
   *
   * @default - true
   */
  readonly previousParameters?: boolean;

  /**
   * The name of the existing CDK toolkit stack (only used for app using legacy synthesis)
   *
   * @default - undefined
   */
  readonly toolkitStackName?: string;

  /**
   * Display mode for stack activity events
   *
   * @default - undefined
   */
  readonly progress?: string;

  /**
   * Rollback stack to stable state on failure. Defaults to 'true', iterate more rapidly with --no-rollback or -R. Note: do **not** disable this flag for deployments with resource replacements, as that will always fail
   *
   * @default - undefined
   */
  readonly rollback?: boolean;

  /**
   * Attempts to perform a 'hotswap' deployment, but does not fall back to a full deployment if that is not possible. Instead, changes to any non-hotswappable properties are ignored.Do not use this in production environments
   *
   * @default - undefined
   */
  readonly hotswap?: boolean;

  /**
   * Attempts to perform a 'hotswap' deployment, which skips CloudFormation and updates the resources directly, and falls back to a full deployment if that is not possible. Do not use this in production environments
   *
   * @default - undefined
   */
  readonly hotswapFallback?: boolean;

  /**
   * Lower limit on the number of your service's tasks that must remain in the RUNNING state during a deployment, as a percentage of the desiredCount
   *
   * @default - undefined
   */
  readonly hotswapEcsMinimumHealthyPercent?: string;

  /**
   * Upper limit on the number of your service's tasks that are allowed in the RUNNING or PENDING state during a deployment, as a percentage of the desiredCount
   *
   * @default - undefined
   */
  readonly hotswapEcsMaximumHealthyPercent?: string;

  /**
   * Number of seconds to wait for a single service to reach stable state, where the desiredCount is equal to the runningCount
   *
   * @default - undefined
   */
  readonly hotswapEcsStabilizationTimeoutSeconds?: string;

  /**
   * Continuously observe the project files, and deploy the given stack(s) automatically when changes are detected. Implies --hotswap by default
   *
   * @default - undefined
   */
  readonly watch?: boolean;

  /**
   * Show CloudWatch log events from all resources in the selected Stacks in the terminal. 'true' by default, use --no-logs to turn off. Only in effect if specified alongside the '--watch' option
   *
   * @default - true
   */
  readonly logs?: boolean;

  /**
   * Maximum number of simultaneous deployments (dependency permitting) to execute.
   *
   * @default - 1
   */
  readonly concurrency?: number;

  /**
   * Whether to build/publish assets in parallel
   *
   * @default - undefined
   */
  readonly assetParallelism?: boolean;

  /**
   * Whether to build all assets before deploying the first stack (useful for failing Docker builds)
   *
   * @default - true
   */
  readonly assetPrebuild?: boolean;

  /**
   * Whether to deploy if the app contains no stacks
   *
   * @default - false
   */
  readonly ignoreNoStacks?: boolean;

  /**
   * Positional argument for deploy
   */
  readonly STACKS?: Array<string>;
}

/**
 * Rolls back the stack(s) named STACKS to their last stable state
 *
 * @struct
 */
export interface RollbackOptions {
  /**
   * Roll back all available stacks
   *
   * @default - false
   */
  readonly all?: boolean;

  /**
   * The name of the CDK toolkit stack the environment is bootstrapped with
   *
   * @default - undefined
   */
  readonly toolkitStackName?: string;

  /**
   * Orphan all resources for which the rollback operation fails.
   *
   * aliases: f
   *
   * @default - undefined
   */
  readonly force?: boolean;

  /**
   * Whether to validate the bootstrap stack version. Defaults to 'true', disable with --no-validate-bootstrap-version.
   *
   * @default - undefined
   */
  readonly validateBootstrapVersion?: boolean;

  /**
   * Orphan the given resources, identified by their logical ID (can be specified multiple times)
   *
   * @default - []
   */
  readonly orphan?: Array<string>;

  /**
   * Positional argument for rollback
   */
  readonly STACKS?: Array<string>;
}

/**
 * Import existing resource(s) into the given STACK
 *
 * @struct
 */
export interface ImportOptions {
  /**
   * Whether to execute ChangeSet (--no-execute will NOT execute the ChangeSet)
   *
   * @default - true
   */
  readonly execute?: boolean;

  /**
   * Name of the CloudFormation change set to create
   *
   * @default - undefined
   */
  readonly changeSetName?: string;

  /**
   * The name of the CDK toolkit stack to create
   *
   * @default - undefined
   */
  readonly toolkitStackName?: string;

  /**
   * Rollback stack to stable state on failure. Defaults to 'true', iterate more rapidly with --no-rollback or -R. Note: do **not** disable this flag for deployments with resource replacements, as that will always fail
   *
   * @default - undefined
   */
  readonly rollback?: boolean;

  /**
   * Do not abort if the template diff includes updates or deletes. This is probably safe but we're not sure, let us know how it goes.
   *
   * aliases: f
   *
   * @default - undefined
   */
  readonly force?: boolean;

  /**
   * If specified, CDK will generate a mapping of existing physical resources to CDK resources to be imported as. The mapping will be written in the given file path. No actual import operation will be performed
   *
   * aliases: r
   *
   * @default - undefined
   */
  readonly recordResourceMapping?: string;

  /**
   * If specified, CDK will use the given file to map physical resources to CDK resources for import, instead of interactively asking the user. Can be run from scripts
   *
   * aliases: m
   *
   * @default - undefined
   */
  readonly resourceMapping?: string;

  /**
   * Positional argument for import
   */
  readonly STACK?: string;
}

/**
 * Shortcut for 'deploy --watch'
 *
 * @struct
 */
export interface WatchOptions {
  /**
   * Do not rebuild asset with the given ID. Can be specified multiple times
   *
   * aliases: E
   *
   * @default - []
   */
  readonly buildExclude?: Array<string>;

  /**
   * Only deploy requested stacks, don't include dependencies
   *
   * aliases: e
   *
   * @default - undefined
   */
  readonly exclusively?: boolean;

  /**
   * Name of the CloudFormation change set to create
   *
   * @default - undefined
   */
  readonly changeSetName?: string;

  /**
   * Always deploy stack even if templates are identical
   *
   * aliases: f
   *
   * @default - false
   */
  readonly force?: boolean;

  /**
   * The name of the existing CDK toolkit stack (only used for app using legacy synthesis)
   *
   * @default - undefined
   */
  readonly toolkitStackName?: string;

  /**
   * Display mode for stack activity events
   *
   * @default - undefined
   */
  readonly progress?: string;

  /**
   * Rollback stack to stable state on failure. Defaults to 'true', iterate more rapidly with --no-rollback or -R. Note: do **not** disable this flag for deployments with resource replacements, as that will always fail
   *
   * @default - undefined
   */
  readonly rollback?: boolean;

  /**
   * Attempts to perform a 'hotswap' deployment, but does not fall back to a full deployment if that is not possible. Instead, changes to any non-hotswappable properties are ignored.'true' by default, use --no-hotswap to turn off
   *
   * @default - undefined
   */
  readonly hotswap?: boolean;

  /**
   * Attempts to perform a 'hotswap' deployment, which skips CloudFormation and updates the resources directly, and falls back to a full deployment if that is not possible.
   *
   * @default - undefined
   */
  readonly hotswapFallback?: boolean;

  /**
   * Lower limit on the number of your service's tasks that must remain in the RUNNING state during a deployment, as a percentage of the desiredCount
   *
   * @default - undefined
   */
  readonly hotswapEcsMinimumHealthyPercent?: string;

  /**
   * Upper limit on the number of your service's tasks that are allowed in the RUNNING or PENDING state during a deployment, as a percentage of the desiredCount
   *
   * @default - undefined
   */
  readonly hotswapEcsMaximumHealthyPercent?: string;

  /**
   * Number of seconds to wait for a single service to reach stable state, where the desiredCount is equal to the runningCount
   *
   * @default - undefined
   */
  readonly hotswapEcsStabilizationTimeoutSeconds?: string;

  /**
   * Show CloudWatch log events from all resources in the selected Stacks in the terminal. 'true' by default, use --no-logs to turn off
   *
   * @default - true
   */
  readonly logs?: boolean;

  /**
   * Maximum number of simultaneous deployments (dependency permitting) to execute.
   *
   * @default - 1
   */
  readonly concurrency?: number;

  /**
   * Positional argument for watch
   */
  readonly STACKS?: Array<string>;
}

/**
 * Destroy the stack(s) named STACKS
 *
 * @struct
 */
export interface DestroyOptions {
  /**
   * Destroy all available stacks
   *
   * @default - false
   */
  readonly all?: boolean;

  /**
   * Only destroy requested stacks, don't include dependees
   *
   * aliases: e
   *
   * @default - undefined
   */
  readonly exclusively?: boolean;

  /**
   * Do not ask for confirmation before destroying the stacks
   *
   * aliases: f
   *
   * @default - undefined
   */
  readonly force?: boolean;

  /**
   * Positional argument for destroy
   */
  readonly STACKS?: Array<string>;
}

/**
 * Compares the specified stack with the deployed stack or a local template file, and returns with status 1 if any difference is found
 *
 * @struct
 */
export interface DiffOptions {
  /**
   * Only diff requested stacks, don't include dependencies
   *
   * aliases: e
   *
   * @default - undefined
   */
  readonly exclusively?: boolean;

  /**
   * Number of context lines to include in arbitrary JSON diff rendering
   *
   * @default - 3
   */
  readonly contextLines?: number;

  /**
   * The path to the CloudFormation template to compare with
   *
   * @default - undefined
   */
  readonly template?: string;

  /**
   * Do not filter out AWS::CDK::Metadata resources, mangled non-ASCII characters, or the CheckBootstrapVersionRule
   *
   * @default - false
   */
  readonly strict?: boolean;

  /**
   * Only diff for broadened security changes
   *
   * @default - false
   */
  readonly securityOnly?: boolean;

  /**
   * Fail with exit code 1 in case of diff
   *
   * @default - undefined
   */
  readonly fail?: boolean;

  /**
   * Whether to compare against the template with Transforms already processed
   *
   * @default - false
   */
  readonly processed?: boolean;

  /**
   * Do not print stack name and default message when there is no diff to stdout
   *
   * aliases: q
   *
   * @default - false
   */
  readonly quiet?: boolean;

  /**
   * Whether to create a changeset to analyze resource replacements. In this mode, diff will use the deploy role instead of the lookup role.
   *
   * aliases: changeset
   *
   * @default - true
   */
  readonly changeSet?: boolean;

  /**
   * Whether or not the change set imports resources that already exist
   *
   * @default - false
   */
  readonly importExistingResources?: boolean;

  /**
   * Whether to include moves in the diff
   *
   * @default - false
   */
  readonly includeMoves?: boolean;

  /**
   * Positional argument for diff
   */
  readonly STACKS?: Array<string>;
}

/**
 * Detect drifts in the given CloudFormation stack(s)
 *
 * @struct
 */
export interface DriftOptions {
  /**
   * Fail with exit code 1 if drift is detected
   *
   * @default - undefined
   */
  readonly fail?: boolean;

  /**
   * Positional argument for drift
   */
  readonly STACKS?: Array<string>;
}

/**
 * Returns all metadata associated with this stack
 *
 * @struct
 */
export interface MetadataOptions {
  /**
   * Positional argument for metadata
   */
  readonly STACK?: string;
}

/**
 * Acknowledge a notice so that it does not show up anymore
 *
 * aliases: ack
 *
 * @struct
 */
export interface AcknowledgeOptions {
  /**
   * Positional argument for acknowledge
   */
  readonly ID?: string;
}

/**
 * Returns a list of relevant notices
 *
 * @struct
 */
export interface NoticesOptions {
  /**
   * Returns a list of unacknowledged notices
   *
   * aliases: u
   *
   * @default - false
   */
  readonly unacknowledged?: boolean;
}

/**
 * Create a new, empty CDK project from a template.
 *
 * @struct
 */
export interface InitOptions {
  /**
   * The language to be used for the new project (default can be configured in ~/.cdk.json)
   *
   * aliases: l
   *
   * @default - undefined
   */
  readonly language?: string;

  /**
   * List the available templates
   *
   * @default - undefined
   */
  readonly list?: boolean;

  /**
   * If true, only generates project files, without executing additional operations such as setting up a git repo, installing dependencies or compiling the project
   *
   * @default - false
   */
  readonly generateOnly?: boolean;

  /**
   * The version of the CDK library (aws-cdk-lib) to initialize the project with. Defaults to the version that was current when this CLI was built.
   *
   * aliases: V
   *
   * @default - undefined
   */
  readonly libVersion?: string;

  /**
   * Positional argument for init
   */
  readonly TEMPLATE?: string;
}

/**
 * Migrate existing AWS resources into a CDK app
 *
 * @struct
 */
export interface MigrateOptions {
  /**
   * The name assigned to the stack created in the new project. The name of the app will be based off this name as well.
   *
   * aliases: n
   *
   * @default - undefined
   */
  readonly stackName?: string;

  /**
   * The language to be used for the new project
   *
   * aliases: l
   *
   * @default - "typescript"
   */
  readonly language?: string;

  /**
   * The account to retrieve the CloudFormation stack template from
   *
   * @default - undefined
   */
  readonly account?: string;

  /**
   * The region to retrieve the CloudFormation stack template from
   *
   * @default - undefined
   */
  readonly region?: string;

  /**
   * The path to the CloudFormation template to migrate. Use this for locally stored templates
   *
   * @default - undefined
   */
  readonly fromPath?: string;

  /**
   * Use this flag to retrieve the template for an existing CloudFormation stack
   *
   * @default - undefined
   */
  readonly fromStack?: boolean;

  /**
   * The output path for the migrated CDK app
   *
   * @default - undefined
   */
  readonly outputPath?: string;

  /**
   * Determines if a new scan should be created, or the last successful existing scan should be used
   *  options are "new" or "most-recent"
   *
   * @default - undefined
   */
  readonly fromScan?: string;

  /**
   * Filters the resource scan based on the provided criteria in the following format: "key1=value1,key2=value2"
   *  This field can be passed multiple times for OR style filtering:
   *  filtering options:
   *  resource-identifier: A key-value pair that identifies the target resource. i.e. {"ClusterName", "myCluster"}
   *  resource-type-prefix: A string that represents a type-name prefix. i.e. "AWS::DynamoDB::"
   *  tag-key: a string that matches resources with at least one tag with the provided key. i.e. "myTagKey"
   *  tag-value: a string that matches resources with at least one tag with the provided value. i.e. "myTagValue"
   *
   * @default - undefined
   */
  readonly filter?: Array<string>;

  /**
   * Use this flag to zip the generated CDK app
   *
   * @default - undefined
   */
  readonly compress?: boolean;
}

/**
 * Manage cached context values
 *
 * @struct
 */
export interface ContextOptions {
  /**
   * The context key (or its index) to reset
   *
   * aliases: e
   *
   * @default - undefined
   */
  readonly reset?: string;

  /**
   * Ignore missing key error
   *
   * aliases: f
   *
   * @default - false
   */
  readonly force?: boolean;

  /**
   * Clear all context
   *
   * @default - false
   */
  readonly clear?: boolean;
}

/**
 * Opens the reference documentation in a browser
 *
 * aliases: doc
 *
 * @struct
 */
export interface DocsOptions {
  /**
   * the command to use to open the browser, using %u as a placeholder for the path of the file to open
   *
   * aliases: b
   *
   * @default - undefined
   */
  readonly browser?: string;
}

/**
 * Moves resources between stacks or within the same stack
 *
 * @struct
 */
export interface RefactorOptions {
  /**
   * Names of deployed stacks to be considered for resource comparison.
   *
   * @default - undefined
   */
  readonly additionalStackName?: Array<string>;

  /**
   * Do not perform any changes, just show what would be done
   *
   * @default - false
   */
  readonly dryRun?: boolean;

  /**
   * A file that declares overrides to be applied to the list of mappings computed by the CLI.
   *
   * @default - undefined
   */
  readonly overrideFile?: string;

  /**
   * If specified, the command will revert the refactor operation. This is only valid if a mapping file was provided.
   *
   * @default - false
   */
  readonly revert?: boolean;
}

/**
 * Enable or disable anonymous telemetry
 *
 * @struct
 */
export interface CliTelemetryOptions {
  /**
   * Enable anonymous telemetry
   *
   * @default - undefined
   */
  readonly enable?: boolean;

  /**
   * Disable anonymous telemetry
   *
   * @default - undefined
   */
  readonly disable?: boolean;

  /**
   * Report telemetry opt-in/out status
   *
   * @default - undefined
   */
  readonly status?: boolean;
}
