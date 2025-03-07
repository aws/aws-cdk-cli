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
   * Always deploy, even if templates are identical.
   *
   * @default false
   * @deprecated the options currently covers multiple different functionalities and will be split out in future
   */
  readonly force?: boolean;

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
