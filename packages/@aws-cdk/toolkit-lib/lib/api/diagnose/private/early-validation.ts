import type { OperationEvent } from '@aws-sdk/client-cloudformation';
import type { SDK } from '../../aws-auth/sdk';
import type { EnvironmentResources } from '../../environment';

/**
 * A ValidationReporter that checks for early validation errors right after
 * creating the change set. If any are found, it throws an error listing all validation failures.
 * If the DescribeEvents API call fails (for example, due to insufficient permissions),
 * it logs a warning instead.
 */
export class EarlyValidationReporter {
  constructor(private readonly sdk: SDK, private readonly envResources?: EnvironmentResources) {
  }

  public async fetchDetailsString(changeSetName: string, stackName: string): Promise<string> {
    const result = await this.fetchDetailsStructured(changeSetName, stackName);

    switch (result.type) {
      case 'could-not-check':
        return result.message;

      case 'resource-errors':
        const header = `ChangeSet '${changeSetName}' on stack '${stackName}' failed early validation:`;
        if (result.errors.length === 0) {
          return header;
        }
        return [
          `${header}:`,
          ...result.errors.map(e => `  - ${e.message} (at ${e.documentPath})`),
        ].join('\n');
    }
  }

  public async fetchDetailsStructured(changeSetName: string, stackName: string): Promise<EarlyValidationCheckResult> {
    let operationEvents: OperationEvent[] = [];
    try {
      operationEvents = await this.getFailedEvents(stackName, changeSetName);
    } catch (error) {
      let currentVersion: number | undefined = undefined;
      try {
        currentVersion = (await this.envResources?.lookupToolkit())?.version;
      } catch (e) {
      }

      return {
        type: 'could-not-check',
        message: `The template cannot be deployed because of early validation errors, but retrieving more details about those
errors failed (${error}). Make sure you have permissions to call the DescribeEvents API, or re-bootstrap
your environment by running 'cdk bootstrap' to update the Bootstrap CDK Toolkit stack.
Bootstrap toolkit stack version 30 or later is needed; current version: ${currentVersion ?? 'unknown'}.`,
      };
    }

    return  {
      type: 'resource-errors',
      errors: operationEvents.map((ev) => ({
        eventType: ev.EventType ?? '',
        logicalId: ev.LogicalResourceId ?? '',
        message: ev.ValidationStatusReason ?? '',
        physicalId: ev.PhysicalResourceId ? ev.PhysicalResourceId : undefined,
        validationName: ev.ValidationName ?? '',
        documentPath: ev.ValidationPath ?? '',
        resourceType: ev.ResourceType,
      } satisfies EarlyValidationError)),
    };
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

export type EarlyValidationCheckResult =
  | { type: 'could-not-check', message: string }
  | { type: 'resource-errors', errors: EarlyValidationError[] };

export interface EarlyValidationError {
  readonly logicalId: string;
  readonly physicalId?: string;
  readonly message: string;

  readonly resourceType?: string;

  /**
   * Example: `VALIDATION_ERROR`
   */
  readonly eventType: string;

  /**
   * Example: `NAME_CONFLICT_VALIDATION`
   */
  readonly validationName: string;

  /**
   * Example: `/Resources/SomeBucketD5B70704`
   */
  readonly documentPath: string;
}