import type { DeploymentMethod, DeployOptions, HotswapMode } from '..';
import type { CloudWatchLogEventMonitor } from '../../../api/aws-cdk';
import type { StackSelector } from '../../../api/cloud-assembly';

export interface BaseDeployOptions {
  /**
   * Criteria for selecting stacks to deploy
   *
   * @default - all stacks
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
   */
  readonly deploymentMethod?: DeploymentMethod;

  /**
   * Whether to perform a 'hotswap' deployment.
   * A 'hotswap' deployment will attempt to short-circuit CloudFormation
   * and update the affected resources like Lambda functions directly.
   *
   * @default - no hotswap
   */
  readonly hotswap?: HotswapMode;

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
   * @default - false
   */
  readonly traceLogs?: boolean;
}

/**
 * Deploy options needed by the watch command.
 * Intentionally not exported because these options are not
 * meant to be public facing.
 */
export interface ExtendedDeployOptions extends DeployOptions {
  /**
   * The extra string to append to the User-Agent header when performing AWS SDK calls.
   *
   * @default - nothing extra is appended to the User-Agent header
   */
  readonly extraUserAgent?: string;

  /**
   * Allows adding CloudWatch log groups to the log monitor via
   * cloudWatchLogMonitor.setLogGroups();
   *
   * @default - not monitoring CloudWatch logs
   */
  readonly cloudWatchLogMonitor?: CloudWatchLogEventMonitor;
}
