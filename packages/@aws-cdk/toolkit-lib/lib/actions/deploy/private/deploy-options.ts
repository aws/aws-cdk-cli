import type { DeployOptions } from '..';
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
