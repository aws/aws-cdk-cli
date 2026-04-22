import { ChangeSetStatus, ChangeSetSummary, ChangeType, Stack } from "@aws-sdk/client-cloudformation";
import { ICloudFormationClient, SDK } from "../aws-auth/sdk";
import { EnvironmentResources } from "../environment";
import { OldestEvent, StackEventPoller } from "../stack-events";
import { ResourceError, ResourceErrors } from "../stack-events/resource-errors";
import { StackStatus } from "../stack-events/stack-status";
import { EarlyValidationError, EarlyValidationReporter } from "./early-validation";
import { ISourceTracer } from "../source-tracing/private/source-tracing";
import { createBranded } from "../../util/type-brands";
import { StackDiagnosis, TracedResourceError } from "../../actions/diagnose";
import { IoHelper } from "../io/private/io-helper";

export interface CloudFormationStackDiagnoserProps {
  readonly sdk: SDK;
  readonly envResources?: EnvironmentResources;
  readonly sourceTracer: ISourceTracer;
  readonly ioHelper: IoHelper;
}

/**
 * Diagnose a stack's failed state
 *
 * - First, determine the stack's state.
 * - If it is in a failed state, we started a deployment that failed. Describe the stack
 *   events, and try to determine the root cause from that.
 * - If it is in a normal state, see if there are any failed change sets. Either
 *   get the failure message from the change set, or get the failure events from
 *   the change set (early validation).
 *
 * This class works at the CloudFormation level, and does not deal with tracing
 * CloudFormation errors to construct code sources yet.
 */
export class CloudFormationStackDiagnoser {
  private readonly cfn: ICloudFormationClient;
  private parentStackLogicalIds: string[];

  constructor(private readonly props: CloudFormationStackDiagnoserProps) {
    this.cfn = this.props.sdk.cloudFormation();
    this.parentStackLogicalIds = [];
  }

  /**
   * Diagnose a stack's root cause given no pre-existing state
   */
  public async diagnoseFromFresh(stackName: string): Promise<StackDiagnosis> {
    try {
      const response = await this.cfn.describeStacks({ StackName: stackName });
      const stack = response.Stacks?.[0];
      if (!stack) {
        return {
          type: 'error-diagnosing',
          message: `Stack with name ${stackName} not found`,
        };
      }

      const status = StackStatus.fromStackDescription(stack);
      if (status.isInProgress) {
        return {
          type: 'error-diagnosing',
          message: `Stack with name ${stackName} is currently being updated (${status.name}). Try again when it's finished.`,
        };
      }

      if (status.isFailure) {
        return await this._diagnoseViaStackEvents(stackName, stack);
      }

      return await this._diagnoseChangeSetFailureFromStackName(stackName);

    } catch (e: any) {
      return { type: 'error-diagnosing', message: e.message };
    }
  }

  /**
   * Diagnose potential problems with the change set
   */
  public async diagnoseChangeSet(changeSet: ChangeSetSummary): Promise<StackDiagnosis> {
    try {
      return await this._diagnoseChangeSetFailure(changeSet);
    } catch (e: any) {
      return { type: 'error-diagnosing', message: e.message };
    }
  }

  /**
   * Diagnose potential problems with the change set
   */
  public async diagnoseFromErrorCollection(errors: ResourceErrors, stack: Stack): Promise<StackDiagnosis> {
    if (errors.isEmpty()) {
      return { type: 'no-problem' };
    }

    return {
      type: 'problem',
      detectedBy: {
        type: 'deployment',
        stackStatus: stack.StackStatus ?? '',
        statusReason: stack.StackStatusReason ?? '',
      },
      problems: await this.addErrorTraces(errors.all),
    };
  }

  /**
   * Diagnose a deployment failure via stack events
   *
   * This is the same logic that the deployment monitor uses.
   */
  private async _diagnoseViaStackEvents(stackName: string, stack: Stack): Promise<StackDiagnosis> {
    const poller = new StackEventPoller(this.cfn, {
      stackName,
      oldestEvent: OldestEvent.mostRecentOperation(),
    });

    // We don't need the resulting events of polling. Polling will automatically update the error collection,
    // which is the thing we care about.
    await poller.poll();

    return this.diagnoseFromErrorCollection(poller.errors, stack);
  }

  private async _diagnoseChangeSetFailureFromStackName(stackName: string): Promise<StackDiagnosis> {
    const cs = (await this.cfn.listChangeSets({
      StackName: stackName,
    })).Summaries ?? [];

    const pending = cs.filter(x => x.Status === ChangeSetStatus.CREATE_IN_PROGRESS || x.Status === ChangeSetStatus.CREATE_PENDING);
    if (pending.length > 0) {
      return {
        type: 'error-diagnosing',
        message: `Stack with name ${stackName} has change sets currently being created (${pending[0].ChangeSetName}). Try again when it's finished.`,
      };
    }

    const failed = cs.filter(x => x.Status === ChangeSetStatus.FAILED);
    if (failed.length === 0) {
      return { type: 'no-problem' }
    }

    return this._diagnoseChangeSetFailure(failed[0]);
  }

  /**
   * Try to diagnose the reason that caused a changeset to fail to create
   *
   * There are a couple of different reasons this can happen, and we go through each of them in order.
   *
   * Usually this starts from trying to detect an error message pattern in the change set status reason,
   * and then potentially going to fetch additional information using additional API calls.
   */
  private async _diagnoseChangeSetFailure(changeSet: ChangeSetSummary): Promise<StackDiagnosis> {
    if (changeSetHasNoChanges(changeSet)) {
      // This will lead to a change set that is FAILED but it's not actually a problem
      return { type: 'no-problem' }
    }

    const isEarlyValidationError = changeSet.StatusReason?.includes('AWS::EarlyValidation');
    if (isEarlyValidationError) {
      const ev = await new EarlyValidationReporter(this.props.sdk, this.props.envResources).fetchDetailsStructured(changeSet.ChangeSetName!, changeSet.StackName!);
      switch (ev.type) {
        case 'could-not-check':
          // Emit the warning here and otherwise just return an empty error block
          this.props.ioHelper.defaults.warn(ev.message);
          return {
            type: 'problem',
            detectedBy: {
              type: 'early-validation',
              changeSetName: changeSet.ChangeSetName ?? '',
            },
            problems: [],
          };
        case 'resource-errors':
          return {
            type: 'problem',
            detectedBy: {
              type: 'early-validation',
              changeSetName: changeSet.ChangeSetName ?? '',
            },
            problems: await this.addErrorTraces(ev.errors.map((e) => resourceErrorFromEarlyValidationError(changeSet.StackId ?? '', this.parentStackLogicalIds, e))),
          };
      }
    }

    if (changeSet.StatusReason?.includes('Nested change set')) {
      return this._diagnoseNestedChangeSetFailure(changeSet);
    }

    const failedAutoErrors = this._tryDetectFailedAutoImport(changeSet);
    if (failedAutoErrors) {
      return {
        type: 'problem',
        detectedBy: {
          type: 'change-set',
          changeSetStatus: changeSet.Status ?? '',
          changeSetName: changeSet.ChangeSetName ?? '',
          statusReason: changeSet.StatusReason ?? '',
        },
        problems: await this.addErrorTraces(failedAutoErrors),
      };
    }

    return this._nonSpecificChangeSetError(changeSet);
  }

  private async addErrorTraces(errs: readonly ResourceError[]): Promise<TracedResourceError[]> {
    return Promise.all(errs.map((e) => this.addErrorTrace(e)));
  }

  private async addErrorTrace(err: ResourceError): Promise<TracedResourceError> {
    let sourceTrace;
    if (err.logicalId) {
      sourceTrace = await this.props.sourceTracer.traceResource(err.stackId, err.parentStackLogicalIds, err.logicalId);
    } else {
      sourceTrace = await this.props.sourceTracer.traceStack(err.stackId, err.parentStackLogicalIds);
    }

    return createBranded({ ...err, sourceTrace });
  }

  /**
   * Build a generic stack error from the given change set information
   *
   * We can't point to a specific resource.
   */
  private async _nonSpecificChangeSetError(changeSet: ChangeSetSummary): Promise<StackDiagnosis> {
    return {
      type: 'problem',
      detectedBy: {
        type: 'change-set',
        changeSetName: changeSet.ChangeSetName ?? '',
        changeSetStatus: changeSet.Status ?? '',
        statusReason: changeSet.StatusReason ?? '',
      },
      problems: [
        await this.addErrorTrace({
          // It's about a stack
          logicalId: undefined,
          message: changeSet.StatusReason ?? '',
          parentStackLogicalIds: this.parentStackLogicalIds,
          stackId: changeSet.StackId ?? '',
          physicalId: changeSet.StackId,
          resourceType: 'AWS::CloudFormation::Stack',
        }),
      ],
    };
  }

  /**
   * Look for nested change sets that have failed, and diagnose those.
   */
  private async _diagnoseNestedChangeSetFailure(changeSet: ChangeSetSummary): Promise<StackDiagnosis> {
    const nested = await this._findFailedNestedStack(changeSet);
    if (!nested) {
      // That's weird. Let's return the change set's status reason as a non-specific error
      return this._nonSpecificChangeSetError(changeSet);
    }

    const nestedCs = await this.cfn.describeChangeSet({
      ChangeSetName: nested.changeSetName,
      StackName: nested.stackName,
    });

    const nestedDiag = new CloudFormationStackDiagnoser(this.props);
    nestedDiag.parentStackLogicalIds = [...this.parentStackLogicalIds, nested.logicalId];
    return nestedDiag._diagnoseChangeSetFailure(nestedCs);
  }

  private async _findFailedNestedStack(changeSet: ChangeSetSummary): Promise<{ stackName: string, changeSetName: string; logicalId: string } | undefined> {
    // The status reason only includes the change set ID, but we also need the stack name. The way to get this is
    // describe the current change set, then from the Changes find the stack whose ChangeSetId is mentioned in the
    // status reason, then look up that change set and recurse into a regular change set diagnosis.
    let nextToken = undefined;
    do {
      // Changes in this response might be paginated
      const resp = await this.cfn.describeChangeSet({
        StackName: changeSet.StackName,
        ChangeSetName: changeSet.ChangeSetName,
        ...nextToken ? { NextToken: nextToken } : {},
      });

      for (const change of resp.Changes ?? []) {
        if (change.Type === ChangeType.Resource && change.ResourceChange?.ResourceType === 'AWS::CloudFormation::Stack' && change.ResourceChange?.ChangeSetId && changeSet.StatusReason?.includes(change.ResourceChange?.ChangeSetId)) {
          return {
            changeSetName: change.ResourceChange.ChangeSetId,
            stackName: change.ResourceChange.PhysicalResourceId ?? '',
            logicalId: change.ResourceChange.LogicalResourceId ?? '',
          };
        }
      }

      nextToken = resp.NextToken;
    } while (nextToken);

    return undefined;
  }

  /**
   * Try to parse failed auto-imports out from a change set status
   *
   * The pattern looks like this:
   *
   * ```
   * CloudFormation is attempting to import some resources because they already exist in your account. The resources must have the DeletionPolicy attribute set to 'Retain' or 'RetainExceptOnCreate' in the template for successful import. The affected resources are SomeBucketD5B70704 ({BucketName=zomaareenbucket})
   * ```
   *
   * Followed by
   *
   * ```
   * LogicalID ({Prop=Value,Prop=Value}), LogicalID ({Prop=Value}), ...
   * ```
   */
  private _tryDetectFailedAutoImport(changeSet: ChangeSetSummary): ResourceError[] | undefined {
    const message = changeSet.StatusReason;
    // Only enhance the specific CFN error about importing existing resources
    if (!message?.includes('CloudFormation is attempting to import some resources because they already exist in your account')) {
      return undefined;
    }

    const marker = 'The affected resources are ';
    const markerIndex = message.indexOf(marker);
    if (markerIndex === -1) {
      return undefined;
    }


    const ret: ResourceError[] = [];
    let remaining = message.slice(markerIndex + marker.length);
    while (remaining) {
      const endIx = remaining.indexOf('), ');
      const thisResource = endIx > -1 ? remaining.slice(0, endIx + 1) : remaining;
      remaining = remaining.slice(thisResource.length + 2);

      // thisResource = "LogicalId ({Prop=Value, Prop=Value})"
      const openParen = thisResource.indexOf('(');
      const logicalId = openParen > -1 ? thisResource.slice(0, openParen).trim() : undefined;

      ret.push({
        message: `Automatic import of existing resource ${thisResource} needs a DeletionPolicy of \'Retain\' or \'RetainExceptOnCreate\'. Set the removal policy to \'RemovalPolicy.RETAIN\' or \'RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE\' (see See https://docs.aws.amazon.com/cdk/v2/guide/resources.html#resources-removal)`,
        parentStackLogicalIds: this.parentStackLogicalIds,
        stackId: changeSet.StackId ?? '',
        errorCode: 'AutomaticImportNeedsRetain',
        logicalId,
      });
    }
    return ret;
  }
}

/**
 * Return true if the given change set has no changes
 *
 * This must be determined from the status, not the 'Changes' array on the
 * object; the latter can be empty because no resources were changed, but if
 * there are changes to Outputs, the change set can still be executed.
 */
export function changeSetHasNoChanges(description: ChangeSetSummary) {
  const noChangeErrorPrefixes = [
    // Error message for a regular template
    "The submitted information didn't contain changes.",
    // Error message when a Transform is involved (see #10650)
    'No updates are to be performed.',
  ];

  return (
    description.Status === 'FAILED' && noChangeErrorPrefixes.some((p) => (description.StatusReason ?? '').startsWith(p))
  );
}

function resourceErrorFromEarlyValidationError(stackId: string, parentStackLogicalIds: string[], ev: EarlyValidationError): ResourceError {
  return {
    logicalId: ev.logicalId,
    physicalId: ev.physicalId,
    resourceType: ev.resourceType,
    message: `${ev.message} (at ${ev.documentPath})`,
    errorCode: `${ev.validationName}_${ev.eventType}`,
    parentStackLogicalIds,
    stackId,
  };
}
