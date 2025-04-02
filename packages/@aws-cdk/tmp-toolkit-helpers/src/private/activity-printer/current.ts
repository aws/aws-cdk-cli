import * as util from 'util';
import * as chalk from 'chalk';
import type { ActivityPrinterProps } from './base';
import { ActivityPrinterBase } from './base';
import { RewritableBlock } from './display';
import type { StackActivity } from '../../api/io/payloads';
import { padLeft, padRight, stackEventHasErrorMessage } from '../../util';

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

  constructor(props: ActivityPrinterProps) {
    super(props);
    this.block = new RewritableBlock(this.stream);
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

    // Normally we'd only print "resources in progress", but it's also useful
    // to keep an eye on the failures and know about the specific errors asquickly
    // as possible (while the stack is still rolling back), so add those in.
    const toPrint: StackActivity[] = [...this.failures, ...Object.values(this.resourcesInProgress)];
    toPrint.sort((a, b) => a.event.Timestamp!.getTime() - b.event.Timestamp!.getTime());

    lines.push(
      ...toPrint.map((res) => {
        const color = colorFromStatusActivity(res.event.ResourceStatus);
        const resourceName = res.metadata?.constructPath ?? res.event.LogicalResourceId ?? '';

        return util.format(
          '%s | %s | %s | %s%s',
          padLeft(CurrentActivityPrinter.TIMESTAMP_WIDTH, new Date(res.event.Timestamp!).toLocaleTimeString()),
          color(padRight(CurrentActivityPrinter.STATUS_WIDTH, (res.event.ResourceStatus || '').slice(0, CurrentActivityPrinter.STATUS_WIDTH))),
          padRight(this.resourceTypeColumnWidth, res.event.ResourceType || ''),
          color(chalk.bold(shorten(40, resourceName))),
          this.failureReasonOnNextLine(res),
        );
      }),
    );

    this.block.displayLines(lines);
  }

  public stop() {
    super.stop();

    // Print failures at the end
    const lines = new Array<string>();
    for (const failure of this.failures) {
      // Root stack failures are not interesting
      if (this.isActivityForTheStack(failure)) {
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
    return stackEventHasErrorMessage(activity.event.ResourceStatus ?? '')
      ? `\n${' '.repeat(CurrentActivityPrinter.TIMESTAMP_WIDTH + CurrentActivityPrinter.STATUS_WIDTH + 6)}${chalk.red(this.failureReason(activity) ?? '')}`
      : '';
  }
}

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

