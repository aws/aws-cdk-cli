import type { OperationEvent } from '@aws-sdk/client-cloudformation';
import type { SDK } from '../aws-auth/sdk';
import type { EnvironmentResources } from '../environment';
import { IoHelper } from '../io/private/io-helper';

/**
 * A ValidationReporter that checks for early validation errors right after
 * creating the change set.
 */
export class EarlyValidationReporter {
  constructor(private readonly sdk: SDK, private readonly envResources?: EnvironmentResources) {
  }

  /**
   * Fetch the details and return them as a string.
   *
   * If the details could not be fetched, log that as a warning using the IoHelper.
   */
  public async fetchDetailsString(changeSetName: string, stackName: string, ioHelper: IoHelper): Promise<string> {
    const summary = `Early validation failed for stack '${stackName}' (ChangeSet '${changeSetName}')`;
    const result = await this.fetchDetailsStructured(changeSetName, stackName);

    switch (result.type) {
      case 'could-not-check':
        await ioHelper.defaults.warn(result.message);
        return summary;

      case 'resource-errors':
        if (result.errors.length === 0) {
          return summary;
        }
        return [
          `${summary}:`,
          ...result.errors.map(e => `  - ${e.message} (at ${e.documentPath})`),
        ].join('\n');
    }
  }

  /**
   * Fetch the details and return them in structured form.
   */
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