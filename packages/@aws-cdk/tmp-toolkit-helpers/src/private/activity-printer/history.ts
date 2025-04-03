import * as util from 'util';
import * as chalk from 'chalk';
import type { ActivityPrinterProps } from './base';
import { ActivityPrinterBase } from './base';
import type { StackActivity } from '../../payloads';
import { padRight } from '../../util';

/**
 * Activity Printer which shows a full log of all CloudFormation events
 *
 * When there hasn't been activity for a while, it will print the resources
 * that are currently in progress, to show what's holding up the deployment.
 */
export class HistoryActivityPrinter extends ActivityPrinterBase {
  /**
   * Last time we printed something to the console.
   *
   * Used to measure timeout for progress reporting.
   */
  private lastPrintTime = Date.now();

  private lastPrinted?: StackActivity;

  /**
   * Number of ms of change absence before we tell the user about the resources that are currently in progress.
   */
  private readonly inProgressDelay = 30_000;

  private readonly printable = new Array<StackActivity>();

  constructor(props: ActivityPrinterProps) {
    super(props);
  }

  public activity(activity: StackActivity) {
    this.printable.push(activity);
    super.activity(activity);
  }

  public stop() {
    super.stop();

    // Print failures at the end
    if (this.failures.length > 0) {
      this.stream.write('\nFailed resources:\n');
      for (const failure of this.failures) {
        // Root stack failures are not interesting
        if (this.isActivityForTheStack(failure)) {
          continue;
        }

        this.printOne(failure, false);
      }
    }
  }

  protected print() {
    for (const activity of this.printable) {
      this.printOne(activity);
      this.lastPrinted = activity;
    }
    this.printable.splice(0, this.printable.length);
    this.printInProgress(this.lastPrinted?.progress.formatted);
  }

  private printOne(activity: StackActivity, progress?: boolean) {
    const event = activity.event;
    const color = colorFromStatusResult(event.ResourceStatus);
    let reasonColor = chalk.cyan;

    let stackTrace = '';
    const metadata = activity.metadata;

    if (event.ResourceStatus && event.ResourceStatus.indexOf('FAILED') !== -1) {
      if (progress == undefined || progress) {
        event.ResourceStatusReason = event.ResourceStatusReason ? this.failureReason(activity) : '';
      }
      if (metadata) {
        stackTrace = metadata.entry.trace ? `\n\t${metadata.entry.trace.join('\n\t\\_ ')}` : '';
      }
      reasonColor = chalk.red;
    }

    const resourceName = metadata ? metadata.constructPath : event.LogicalResourceId || '';
    const logicalId = resourceName !== event.LogicalResourceId ? `(${event.LogicalResourceId}) ` : '';

    this.stream.write(
      util.format(
        '%s | %s%s | %s | %s | %s %s%s%s\n',
        event.StackName,
        progress !== false ? `${activity.progress.formatted} | ` : '',
        new Date(event.Timestamp!).toLocaleTimeString(),
        color(padRight(HistoryActivityPrinter.STATUS_WIDTH, (event.ResourceStatus || '').slice(0, HistoryActivityPrinter.STATUS_WIDTH))), // pad left and trim
        padRight(this.resourceTypeColumnWidth, event.ResourceType || ''),
        color(chalk.bold(resourceName)),
        logicalId,
        reasonColor(chalk.bold(event.ResourceStatusReason ? event.ResourceStatusReason : '')),
        reasonColor(stackTrace),
      ),
    );

    this.lastPrintTime = Date.now();
  }

  /**
   * If some resources are taking a while to create, notify the user about what's currently in progress
   */
  private printInProgress(progress?: string) {
    if (!progress || Date.now() < this.lastPrintTime + this.inProgressDelay) {
      return;
    }

    if (Object.keys(this.resourcesInProgress).length > 0) {
      this.stream.write(
        util.format(
          '%s Currently in progress: %s\n',
          progress,
          chalk.bold(Object.keys(this.resourcesInProgress).join(', ')),
        ),
      );
    }

    // We cheat a bit here. To prevent printInProgress() from repeatedly triggering,
    // we set the timestamp into the future. It will be reset whenever a regular print
    // occurs, after which we can be triggered again.
    this.lastPrintTime = +Infinity;
  }
}

function colorFromStatusResult(status?: string) {
  if (!status) {
    return chalk.reset;
  }

  if (status.indexOf('FAILED') !== -1) {
    return chalk.red;
  }
  if (status.indexOf('ROLLBACK') !== -1) {
    return chalk.yellow;
  }
  if (status.indexOf('COMPLETE') !== -1) {
    return chalk.green;
  }

  return chalk.reset;
}
