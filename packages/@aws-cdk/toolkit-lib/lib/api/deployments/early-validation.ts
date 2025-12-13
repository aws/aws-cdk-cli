import type { OperationEvent } from '@aws-sdk/client-cloudformation';
import type { ValidationReporter } from './cfn-api';
import type { SDK } from '../aws-auth/sdk';
import type { EnvironmentResources } from '../environment';

/**
 * A ValidationReporter that checks for early validation errors right after
 * creating the change set. If any are found, it throws an error listing all validation failures.
 * If the DescribeEvents API call fails (for example, due to insufficient permissions),
 * it logs a warning instead.
 */
export class EarlyValidationReporter implements ValidationReporter {
  constructor(private readonly sdk: SDK, private readonly envResources: EnvironmentResources) {
  }

  public async fetchDetails(changeSetName: string, stackName: string): Promise<string> {
    let operationEvents: OperationEvent[] = [];
    try {
      operationEvents = await this.getFailedEvents(stackName, changeSetName);
    } catch (error) {
      let currentVersion: number | undefined = undefined;
      try {
        currentVersion = (await this.envResources.lookupToolkit()).version;
      } catch (e) {
      }

      return `The template cannot be deployed because of early validation errors, but retrieving more details about those
errors failed (${error}). Make sure you have permissions to call the DescribeEvents API, or re-bootstrap
your environment with the latest version of the CLI (need at least version 30, current version ${currentVersion ?? 'unknown'}).`;
    }

    let message = `ChangeSet '${changeSetName}' on stack '${stackName}' failed early validation`;
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
