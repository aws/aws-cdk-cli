import * as util from 'util';
import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import chalk from 'chalk';
import { ActivityPrinterBase } from './base';
import type { StackActivity } from '../../payloads';

/**
 * Activity Printer that prints nothing, except errors
 *
 * Intended for consumers like AI agents that don't need continuous progress
 * updates, where any output that is not an error is a waste of tokens.
 */
export class ErrorsOnlyActivityPrinter extends ActivityPrinterBase {
  private printedFailures = 0;

  public start(state: { stack: CloudFormationStackArtifact }) {
    super.start(state);
    this.printedFailures = 0;
  }

  public stop() {
    super.stop();

    if (this.failures.some((f) => this.isProvisionalFailure(f))) {
      this.stream.write(chalk.yellow('\n ⚠️  Some resources failed to delete but were skipped. These resources may still exist and could incur charges. Clean them up manually.\n'));
    }
  }

  protected print(): void {
    for (; this.printedFailures < this.failures.length; this.printedFailures++) {
      const failure = this.failures[this.printedFailures];
      // Provisional DELETE_FAILED events will be skipped by CloudFormation; we warn about them at the end
      if (!this.isProvisionalFailure(failure)) {
        this.printFailure(failure);
      }
    }
  }

  private printFailure(activity: StackActivity) {
    const event = activity.event;
    const metadata = activity.metadata;

    const reason = event.ResourceStatusReason ? this.failureReason(activity) : '';
    const resourceName = metadata ? metadata.constructPath : event.LogicalResourceId ?? '';
    const logicalId = resourceName !== event.LogicalResourceId ? ` (${event.LogicalResourceId})` : '';
    const stackTrace = metadata?.entry.trace ? `\n\t${metadata.entry.trace.join('\n\t\\_ ')}` : '';

    this.stream.write(
      util.format(
        '%s | %s | %s | %s%s %s%s\n',
        event.StackName,
        chalk.red(event.ResourceStatus ?? ''),
        event.ResourceType ?? '',
        chalk.red(chalk.bold(resourceName)),
        logicalId,
        chalk.red(chalk.bold(reason)),
        chalk.red(stackTrace),
      ),
    );
  }
}
