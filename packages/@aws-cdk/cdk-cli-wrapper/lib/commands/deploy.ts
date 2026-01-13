import type { DeployOptions as BaseDeployOptions } from '@aws-cdk/cloud-assembly-schema/lib/integ-tests';

/**
 * Options to use with cdk deploy
 */
export interface DeployOptions extends BaseDeployOptions {

  /**
   * Display mode for stack activity events
   *
   * The default in the CLI is StackActivityProgress.BAR, but
   * since the cli-wrapper will most likely be run in automation it makes
   * more sense to set the default to StackActivityProgress.EVENTS
   *
   * @default StackActivityProgress.EVENTS
   */
  readonly progress?: StackActivityProgress;

  /**
   * Whether this 'deploy' command should actually delegate to the 'watch' command.
   *
   * @default false
   */
  readonly watch?: boolean;

  /**
   * Whether to perform a 'hotswap' deployment.
   * A 'hotswap' deployment will attempt to short-circuit CloudFormation
   * and update the affected resources like Lambda functions directly.
   *
   * @default - `HotswapMode.FALL_BACK` for regular deployments, `HotswapMode.HOTSWAP_ONLY` for 'watch' deployments
   */
  readonly hotswap?: HotswapMode;

  /**
   * Whether to show CloudWatch logs for hotswapped resources
   * locally in the users terminal
   *
   * @default - false
   */
  readonly traceLogs?: boolean;

  /**
   * Deployment method
   */
  readonly deploymentMethod?: DeploymentMethod;
}
export type DeploymentMethod = 'direct' | 'change-set';

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

/**
 * Supported display modes for stack deployment activity
 */
export enum StackActivityProgress {
  /**
   * Displays a progress bar with only the events for the resource currently being deployed
   */
  BAR = 'bar',

  /**
   * Displays complete history with all CloudFormation stack events
   */
  EVENTS = 'events',
}
