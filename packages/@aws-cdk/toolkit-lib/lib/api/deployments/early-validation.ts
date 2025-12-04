import type { OperationEvent } from '@aws-sdk/client-cloudformation';
import type { ValidationReporter } from './cfn-api';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { SDK } from '../aws-auth/sdk';
import type { IoHelper } from '../io/private';

/**
 * A ValidationReporter that checks for early validation errors right after
 * creating the change set. If any are found, it throws an error listing all validation failures.
 * If the DescribeEvents API call fails (for example, due to insufficient permissions),
 * it logs a warning instead.
 */
export class EarlyValidationReporter implements ValidationReporter {
  constructor(private readonly sdk: SDK, private readonly ioHelper: IoHelper) {
  }

  public async report(changeSetName: string, stackName: string) {
    let operationEvents: OperationEvent[] = [];
    try {
      operationEvents = await this.getFailedEvents(stackName, changeSetName);
    } catch (error) {
      const message =
        'While creating the change set, CloudFormation detected errors in the generated templates,' +
        ' but the deployment role does not have permissions to call the DescribeEvents API to retrieve details about these errors.\n' +
        'To see more details, re-bootstrap your environment, or otherwise ensure that the deployment role has permissions to call the DescribeEvents API.';

      await this.ioHelper.defaults.warn(message);
    }

    if (operationEvents.length > 0) {
      const failures = operationEvents
        .map((event) => `  - ${event.ValidationStatusReason} (at ${event.ValidationPath})`)
        .join('\n');

      const message = `ChangeSet '${changeSetName}' on stack '${stackName}' failed early validation:\n${failures}`;
      throw new ToolkitError(message);
    }
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
