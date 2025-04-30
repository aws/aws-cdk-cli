import * as util from 'util';
import type { StackEvent } from '@aws-sdk/client-cloudformation';
import type { StackProgress } from '../../payloads/progress';
import { padLeft } from '../../util';

/**
 * Monitors stack progress.s
 */
export class StackProgressMonitor {
  /**
   * Previous completion state observed by logical ID
   *
   * We use this to detect that if we see a DELETE_COMPLETE after a
   * CREATE_COMPLETE, it's actually a rollback and we should DECREASE
   * resourcesDone instead of increase it
   */
  private resourcesPrevCompleteState: Record<string, string> = {};

  /**
   * Count of resources that have reported a _COMPLETE status
   */
  private resourcesDone: number = 0;

  /**
   * How many digits we need to represent the total count (for lining up the status reporting)
   */
  private readonly resourceDigits: number = 0;

  /**
   * Number of expected resources in the monitor.
   */
  private readonly resourcesTotal?: number;

  constructor(resourcesTotal?: number) {
    // +1 because the stack also emits a "COMPLETE" event at the end, and that wasn't
    // counted yet. This makes it line up with the amount of events we expect.
    this.resourcesTotal = resourcesTotal ? resourcesTotal + 1 : undefined;

    // How many digits does this number take to represent?
    this.resourceDigits = this.resourcesTotal ? Math.ceil(Math.log10(this.resourcesTotal)) : 0;
  }

  /**
   * Report the stack progress
   */
  public get progress(): StackProgress {
    return {
      total: this.total,
      completed: this.completed,
      formatted: this.formatted,
    };
  }

  /**
   * The total number of progress monitored resources.
   */
  public get total(): number | undefined {
    return this.resourcesTotal;
  }

  /**
   * The number of completed resources.
   */
  public get completed(): number {
    return this.resourcesDone;
  }

  /**
   * Report the current progress as a [34/42] string, or just [34] if the total is unknown
   */
  public get formatted(): string {
    if (this.resourcesTotal == null) {
      // Don't have total, show simple count and hope the human knows
      return padLeft(3, util.format('%s', this.resourcesDone)); // max 500 resources
    }

    return util.format(
      '%s/%s',
      padLeft(this.resourceDigits, this.resourcesDone.toString()),
      padLeft(this.resourceDigits, this.resourcesTotal.toString()),
    );
  }

  /**
   * Process as stack event and update the progress state.
   */
  public process(event: StackEvent): void {
    const status = event.ResourceStatus;
    if (!status || !event.LogicalResourceId) {
      return;
    }

    if (status.endsWith('_COMPLETE_CLEANUP_IN_PROGRESS')) {
      this.resourcesDone++;
    }

    if (status.endsWith('_COMPLETE')) {
      const prevState = this.resourcesPrevCompleteState[event.LogicalResourceId];
      if (!prevState) {
        this.resourcesDone++;
      } else {
        // If we completed this before and we're completing it AGAIN, means we're rolling back.
        // Protect against silly underflow.
        this.resourcesDone--;
        if (this.resourcesDone < 0) {
          this.resourcesDone = 0;
        }
      }
      this.resourcesPrevCompleteState[event.LogicalResourceId] = status;
    }
  }
}
