import type { OperationEvent } from '@aws-sdk/client-cloudformation';
import type { ValidationReporter } from './cfn-api';
import type { SDK } from '../aws-auth/sdk';
import type { EnvironmentResources } from '../environment';
import type { IoHelper } from '../io/private';

/**
 * A ValidationReporter that checks for early validation errors right after
 * creating the change set. If any are found, it throws an error listing all validation failures.
 * If the DescribeEvents API call fails (for example, due to insufficient permissions),
 * it logs a warning instead.
 */
export class EarlyValidationReporter implements ValidationReporter {
  constructor(
    private readonly sdk: SDK,
    private readonly envResources: EnvironmentResources,
    private readonly ioHelper: IoHelper,
  ) {
  }

  public async fetchDetails(changeSetName: string, stackName: string): Promise<string> {
    const summary = `Early validation failed for stack '${stackName}' (ChangeSet '${changeSetName}')`;
    let operationEvents: OperationEvent[] = [];
    try {
      operationEvents = await this.getFailedEvents(stackName, changeSetName);
    } catch (error) {
      let currentVersion: number | undefined = undefined;
      try {
        currentVersion = (await this.envResources.lookupToolkit()).version;
      } catch (e) {
      }

      await this.ioHelper.defaults.warn(
        `Could not retrieve additional details about early validation errors (${error}). ` +
        'Make sure you have permissions to call the DescribeEvents API, or re-bootstrap your environment by running \'cdk bootstrap\' to update the Bootstrap CDK Toolkit stack. ' +
        `Bootstrap toolkit stack version 30 or later is needed; current version: ${currentVersion ?? 'unknown'}.`,
      );
      return summary;
    }

    let message = summary;
    if (operationEvents.length > 0) {
      const failures = operationEvents
        .map((event) => `  - ${event.ValidationStatusReason} (at ${event.ValidationPath})`)
        .join('\n');

      message += `:\n${failures}\n`;
    }
    return message;
  }

  private async getFailedEvents(stackName: string, changeSetName: string) {
    return this.sdk.cloudFormation().paginatedDescribeEvents({
      StackName: stackName,
      ChangeSetName: changeSetName,
      Filters: {
        FailedEvents: true,
      },
    });
  }
}
