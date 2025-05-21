import type { BaseDeployOptions } from './private/deploy-options';
import type { Tag } from '../../api/tags';

export type DeploymentMethod = DirectDeploymentMethod | ChangeSetDeploymentMethod;

export interface DirectDeploymentMethod {
  /**
   * Use stack APIs to the deploy stack changes
   */
  readonly method: 'direct';
}

export interface ChangeSetDeploymentMethod {
  /**
   * Use change-set APIS to deploy a stack changes
   */
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

export enum HotswapMode {
  /**
   * Will fall back to CloudFormation when a non-hotswappable change is detected
   */
  FALL_BACK = 'fall-back',

  /**
   * Will not fall back to CloudFormation when a non-hotswappable change is detected
   */
  HOTSWAP_ONLY = 'hotswap-only',

  /**
   * Will not attempt to hotswap anything and instead go straight to CloudFormation
   */
  FULL_DEPLOYMENT = 'full-deployment',
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

  /**
   * Represents configuration property overrides for hotswap deployments.
   * Currently only supported by ECS.
   *
   * @default - no overrides
   */
  readonly hotswapProperties?: HotswapProperties;
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
