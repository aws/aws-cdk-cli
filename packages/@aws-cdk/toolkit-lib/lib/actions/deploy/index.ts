import type { StackSelector } from '../../api/cloud-assembly';
import type { Tag } from '../../api/tags';

export type DeploymentMethod = DirectDeployment | ChangeSetDeployment | HotswapDeployment;

/**
 * Use stack APIs to the deploy stack changes
 */
export interface DirectDeployment {
  readonly method: 'direct';
}

/**
 * Use change-set APIs to deploy a stack changes
 */
export interface ChangeSetDeployment {
  readonly method: 'change-set';

  /**
   * Whether to execute the changeset or leave it in review.
   *
   * @default true
   */
  readonly execute?: boolean;

  /**
   * Optional name to use for the CloudFormation change set.
   * If not provided, a name will be generated automatically.
   */
  readonly changeSetName?: string;

  /**
   * Indicates if the change set imports resources that already exist.
   *
   * @default false
   */
  readonly importExistingResources?: boolean;

  /**
   * Creates a drift-aware change set that brings actual resource states in line with template definitions.
   *
   * @default false
   */
  readonly revertDrift?: boolean;
}

/**
 * Perform a 'hotswap' deployment to deploy a stack changes
 *
 * A 'hotswap' deployment will attempt to short-circuit CloudFormation
 * and update the affected resources like Lambda functions directly.
 */
export interface HotswapDeployment {
  readonly method: 'hotswap';

  /**
   * Represents configuration property overrides for hotswap deployments.
   * Currently only supported by ECS.
   *
   * @default - No overrides
   */
  readonly properties?: HotswapProperties;

  /**
   * Fall back to a CloudFormation deployment when a non-hotswappable change is detected
   *
   * @default - Do not fall back to a CloudFormation deployment
   */
  readonly fallback?: DirectDeployment | ChangeSetDeployment;
}

/**
 * When to build assets
 */
export enum AssetBuildTime {
  /**
   * Build all assets before deploying the first stack
   *
   * This is intended for expensive Docker image builds; so that if the Docker image build
   * fails, no stacks are unnecessarily deployed (with the attendant wait time).
   */
  ALL_BEFORE_DEPLOY = 'all-before-deploy',

  /**
   * Build assets just-in-time, before publishing
   */
  JUST_IN_TIME = 'just-in-time',
}

export class StackParameters {
  /**
   * Use only existing parameters on the stack.
   */
  public static onlyExisting() {
    return new StackParameters({}, true);
  }

  /**
   * Use exactly these parameters and remove any other existing parameters from the stack.
   */
  public static exactly(params: { [name: string]: string | undefined }) {
    return new StackParameters(params, false);
  }

  /**
   * Define additional parameters for the stack, while keeping existing parameters for unspecified values.
   */
  public static withExisting(params: { [name: string]: string | undefined }) {
    return new StackParameters(params, true);
  }

  public readonly parameters: Map<string, string | undefined>;
  public readonly keepExistingParameters: boolean;

  private constructor(params: { [name: string]: string | undefined }, usePreviousParameters = true) {
    this.keepExistingParameters = usePreviousParameters;
    this.parameters = new Map(Object.entries(params));
  }
}

export interface BaseDeployOptions {
  /**
   * Criteria for selecting stacks to deploy
   *
   * @default - All stacks
   */
  readonly stacks?: StackSelector;

  /**
   * Role to pass to CloudFormation for deployment
   */
  readonly roleArn?: string;

  /**
   * Deploy even if the deployed template is identical to the one we are about to deploy.
   *
   * @default false
   */
  readonly forceDeployment?: boolean;

  /**
   * Deployment method
   *
   * @default ChangeSetDeployment
   */
  readonly deploymentMethod?: DeploymentMethod;

  /**
   * Rollback failed deployments
   *
   * @default true
   */
  readonly rollback?: boolean;

  /**
   * Automatically orphan resources that failed during rollback
   *
   * Has no effect if `rollback` is `false`.
   *
   * @default false
   */
  readonly orphanFailedResourcesDuringRollback?: boolean;

  /**
   * Force asset publishing even if the assets have not changed
   * @default false
   */
  readonly forceAssetPublishing?: boolean;

  /**
   * Reuse the assets with the given asset IDs
   */
  readonly reuseAssets?: string[];

  /**
   * Maximum number of simultaneous deployments (dependency permitting) to execute.
   * The default is '1', which executes all deployments serially.
   *
   * @default 1
   */
  readonly concurrency?: number;

  /**
   * Whether to send logs from all CloudWatch log groups in the template
   * to the IoHost
   *
   * @default false
   */
  readonly traceLogs?: boolean;
}

export interface DeployOptions extends BaseDeployOptions {
  /**
   * ARNs of SNS topics that CloudFormation will notify with stack related events
   */
  readonly notificationArns?: string[];

  /**
   * Tags to pass to CloudFormation for deployment
   */
  readonly tags?: Tag[];

  /**
   * Stack parameters for CloudFormation used at deploy time
   * @default StackParameters.onlyExisting()
   */
  readonly parameters?: StackParameters;

  /**
   * Path to file where stack outputs will be written after a successful deploy as JSON
   * @default - Outputs are not written to any file
   */
  readonly outputsFile?: string;

  /**
   * Build/publish assets for a single stack in parallel
   *
   * Independent of whether stacks are being done in parallel or no.
   *
   * @default true
   */
  readonly assetParallelism?: boolean;

  /**
   * When to build assets
   *
   * The default is the Docker-friendly default.
   *
   * @default AssetBuildTime.ALL_BEFORE_DEPLOY
   */
  readonly assetBuildTime?: AssetBuildTime;
}

/**
 * Property overrides for ECS hotswaps
 */
export interface EcsHotswapProperties {
  /**
   * The lower limit on the number of your service's tasks that must remain
   * in the RUNNING state during a deployment, as a percentage of the desiredCount.
   */
  readonly minimumHealthyPercent?: number;

  /**
   * The upper limit on the number of your service's tasks that are allowed
   * in the RUNNING or PENDING state during a deployment, as a percentage of the desiredCount.
   */
  readonly maximumHealthyPercent?: number;

  /**
   * The number of seconds to wait for a single service to reach stable state.
   */
  readonly stabilizationTimeoutSeconds?: number;
}

/**
 * Property overrides for hotswap deployments.
 */
export interface HotswapProperties {
  /**
   * ECS specific hotswap property overrides
   */
  readonly ecs?: EcsHotswapProperties;
}
