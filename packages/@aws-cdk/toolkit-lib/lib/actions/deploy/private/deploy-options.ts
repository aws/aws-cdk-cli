import type { DeployOptions } from '..';
import type { UserAgentMetadata } from '../../../api/aws-auth/private';
import type { CloudWatchLogEventMonitor } from '../../../api/logs-monitor/logs-monitor';

/**
 * Deploy options needed by the watch command.
 *
 * These options are not public facing.
 *
 * @internal
 */
export interface PrivateDeployOptions extends DeployOptions {
  /**
   * Additional User-Agent tokens to send when performing AWS SDK calls.
   *
   * @default - no additional tokens
   */
  readonly userAgentMetadata?: UserAgentMetadata[];

  /**
   * Allows adding CloudWatch log groups to the log monitor via
   * cloudWatchLogMonitor.setLogGroups();
   *
   * @default - Not monitoring CloudWatch logs
   */
  readonly cloudWatchLogMonitor?: CloudWatchLogEventMonitor;
}
