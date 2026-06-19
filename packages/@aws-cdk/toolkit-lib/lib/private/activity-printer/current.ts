import * as util from 'util';
import chalk from 'chalk';
import type { ActivityPrinterProps } from './base';
import { ActivityPrinterBase } from './base';
import { RewritableBlock } from './display';
import type { StackActivity } from '../../payloads';
import { isErrorEvent, padLeft, padRight } from '../../util';

/**
 * Activity Printer which shows the resources currently being updated
 *
 * It will continuously re-update the terminal and show only the resources
 * that are currently being updated, in addition to a progress bar which
 * shows how far along the deployment is.
 *
 * Resources that have failed will always be shown, and will be recapitulated
 * along with their stack trace when the monitoring ends.
 *
 * Resources that failed deployment because they have been cancelled are
 * not included.
 */
export class CurrentActivityPrinter extends ActivityPrinterBase {
  /**
   * Continuously write to the same output block.
   */
  private block: RewritableBlock;

  /**
   * Resources that completed but are still stabilizing (Express Mode), keyed by
   * logical ID. These are shown transiently and removed after
   * `STABILIZING_DISPLAY_MS` so they don't clutter the output.
   */
  private readonly stabilizing: Record<string, { activity: StackActivity; shownAt: number }> = {};

  constructor(props: ActivityPrinterProps) {
    super(props);
    this.block = new RewritableBlock(this.stream);
  }

  protected addActivity(activity: StackActivity) {
    super.addActivity(activity);

    // In Express Mode, CloudFormation reports a resource as CREATE_COMPLETE or
    // UPDATE_COMPLETE while it is still stabilizing, surfacing this via a status
    // reason. Show it transiently so the user is aware, then let it disappear to
    // avoid clutter. DELETE_COMPLETE is excluded: a deleted resource is gone, so
    // there is nothing left stabilizing to report.
    const event = activity.event;
    const status = event.ResourceStatus;
    const isStabilizingComplete = status === 'CREATE_COMPLETE' || status === 'UPDATE_COMPLETE';
    if (
      isStabilizingComplete &&
      event.ResourceStatusReason &&
      event.LogicalResourceId &&
      !this.isActivityForTheStack(activity)
    ) {
      this.stabilizing[event.LogicalResourceId] = { activity, shownAt: Date.now() };
    }
  }

  protected print(): void {
    const lines = [];

    // Add a progress bar at the top
    const progressWidth = Math.max(
      Math.min((this.block.width ?? 80) - PROGRESSBAR_EXTRA_SPACE - 1, MAX_PROGRESSBAR_WIDTH),
      MIN_PROGRESSBAR_WIDTH,
    );
    const prog = this.progressBar(progressWidth);
    if (prog) {
      lines.push('  ' + prog, '');
    }

    // Drop stabilizing resources whose transient display window has elapsed.
    const now = Date.now();
    for (const [logicalId, entry] of Object.entries(this.stabilizing)) {
      if (now - entry.shownAt > STABILIZING_DISPLAY_MS) {
        delete this.stabilizing[logicalId];
      }
    }

    // Normally we'd only print "resources in progress", but it's also useful
    // to keep an eye on the failures and know about the specific errors asquickly
    // as possible (while the stack is still rolling back), so add those in.
    // We also surface still-stabilizing resources (Express Mode) for a short while.
    const toPrint: StackActivity[] = [
      ...this.failures,
      ...Object.values(this.resourcesInProgress),
      ...Object.values(this.stabilizing).map((e) => e.activity),
    ];
    toPrint.sort((a, b) => a.event.Timestamp!.getTime() - b.event.Timestamp!.getTime());

    lines.push(
      ...toPrint.map((res) => {
        const provisional = this.isProvisionalFailure(res);
        const color = provisional ? chalk.yellow : colorFromStatusActivity(res.event.ResourceStatus);
        const resourceName = res.metadata?.constructPath ?? res.event.LogicalResourceId ?? '';
        const statusText = provisional
          ? `${(res.event.ResourceStatus || '').slice(0, CurrentActivityPrinter.STATUS_WIDTH)} (skipped)`
          : (res.event.ResourceStatus || '').slice(0, CurrentActivityPrinter.STATUS_WIDTH);

        return util.format(
          '%s | %s | %s | %s%s',
          padLeft(CurrentActivityPrinter.TIMESTAMP_WIDTH, new Date(res.event.Timestamp!).toLocaleTimeString()),
          color(padRight(CurrentActivityPrinter.STATUS_WIDTH, statusText)),
          padRight(this.resourceTypeColumnWidth, res.event.ResourceType || ''),
          color(chalk.bold(shorten(40, resourceName))),
          provisional ? ' (this will take a few minutes to recover)' : this.reasonOnNextLine(res),
        );
      }),
    );

    this.block.displayLines(lines);
  }

  /**
   * Reason to show on the next line: the failure reason for error events, or the
   * stabilization reason for resources that completed but are still stabilizing.
   */
  private reasonOnNextLine(activity: StackActivity) {
    if (isErrorEvent(activity.event)) {
      return this.failureReasonOnNextLine(activity);
    }
    // Only surface the status reason for the terminal *_COMPLETE statuses, where
    // it carries the Express Mode stabilization message. For other statuses
    // (e.g. *_IN_PROGRESS) the reason is just noise.
    const status = activity.event.ResourceStatus;
    const isStabilizingComplete = status === 'CREATE_COMPLETE' || status === 'UPDATE_COMPLETE';
    const reason = activity.event.ResourceStatusReason;
    return reason && isStabilizingComplete
      ? `\n${' '.repeat(CurrentActivityPrinter.TIMESTAMP_WIDTH + CurrentActivityPrinter.STATUS_WIDTH + 6)}${chalk.yellow(reason)}`
      : '';
  }

  public stop() {
    super.stop();

    // Print failures at the end (excluding provisional DELETE_FAILED during updates)
    const lines = new Array<string>();
    for (const failure of this.failures) {
      if (this.isActivityForTheStack(failure) || this.isProvisionalFailure(failure)) {
        continue;
      }

      lines.push(
        util.format(
          chalk.red('%s | %s | %s | %s%s') + '\n',
          padLeft(CurrentActivityPrinter.TIMESTAMP_WIDTH, new Date(failure.event.Timestamp!).toLocaleTimeString()),
          padRight(CurrentActivityPrinter.STATUS_WIDTH, (failure.event.ResourceStatus || '').slice(0, CurrentActivityPrinter.STATUS_WIDTH)),
          padRight(this.resourceTypeColumnWidth, failure.event.ResourceType || ''),
          shorten(40, failure.event.LogicalResourceId ?? ''),
          this.failureReasonOnNextLine(failure),
        ),
      );

      const trace = failure.metadata?.entry?.trace;
      if (trace) {
        lines.push(chalk.red(`\t${trace.join('\n\t\\_ ')}\n`));
      }
    }

    if (this.failures.some((f) => this.isProvisionalFailure(f))) {
      lines.push(chalk.yellow('\n ⚠️  Some resources failed to delete but were skipped. These resources may still exist and could incur charges. Clean them up manually.\n'));
    }

    // Display in the same block space, otherwise we're going to have silly empty lines.
    this.block.displayLines(lines);
    this.block.removeEmptyLines();
  }

  private progressBar(width: number) {
    if (!this.stackProgress || !this.stackProgress.total) {
      return '';
    }
    const fraction = Math.min(this.stackProgress.completed / this.stackProgress.total, 1);
    const innerWidth = Math.max(1, width - 2);
    const chars = innerWidth * fraction;
    const remainder = chars - Math.floor(chars);

    const fullChars = FULL_BLOCK.repeat(Math.floor(chars));
    const partialChar = PARTIAL_BLOCK[Math.floor(remainder * PARTIAL_BLOCK.length)];
    const filler = '·'.repeat(innerWidth - Math.floor(chars) - (partialChar ? 1 : 0));

    const color = this.rollingBack ? chalk.yellow : chalk.green;

    return '[' + color(fullChars + partialChar) + filler + `] (${this.stackProgress.completed}/${this.stackProgress.total})`;
  }

  private failureReasonOnNextLine(activity: StackActivity) {
    return isErrorEvent(activity.event)
      ? `\n${' '.repeat(CurrentActivityPrinter.TIMESTAMP_WIDTH + CurrentActivityPrinter.STATUS_WIDTH + 6)}${chalk.red(this.failureReason(activity) ?? '')}`
      : '';
  }
}

/**
 * How long a still-stabilizing (Express Mode) resource stays visible in the
 * live view before it disappears, to avoid cluttering the output.
 */
const STABILIZING_DISPLAY_MS = 2_000;

const FULL_BLOCK = '█';
const PARTIAL_BLOCK = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const MAX_PROGRESSBAR_WIDTH = 60;
const MIN_PROGRESSBAR_WIDTH = 10;
const PROGRESSBAR_EXTRA_SPACE =
    2 /* leading spaces */ + 2 /* brackets */ + 4 /* progress number decoration */ + 6; /* 2 progress numbers up to 999 */

function colorFromStatusActivity(status?: string) {
  if (!status) {
    return chalk.reset;
  }

  if (status.endsWith('_FAILED')) {
    return chalk.red;
  }

  if (status.startsWith('CREATE_') || status.startsWith('UPDATE_') || status.startsWith('IMPORT_')) {
    return chalk.green;
  }
  // For stacks, it may also be 'UPDDATE_ROLLBACK_IN_PROGRESS'
  if (status.indexOf('ROLLBACK_') !== -1) {
    return chalk.yellow;
  }
  if (status.startsWith('DELETE_')) {
    return chalk.yellow;
  }

  return chalk.reset;
}

function shorten(maxWidth: number, p: string) {
  if (p.length <= maxWidth) {
    return p;
  }
  const half = Math.floor((maxWidth - 3) / 2);
  return p.slice(0, half) + '...' + p.slice(-half);
}

