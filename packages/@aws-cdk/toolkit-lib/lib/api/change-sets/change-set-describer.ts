import { format } from 'node:util';
import type { Change, DescribeChangeSetCommandOutput, ResourceChangeDetail } from '@aws-sdk/client-cloudformation';
import { ChangeSetStatus } from '@aws-sdk/client-cloudformation';
import { DeploymentError } from '../../toolkit/toolkit-error';
import { changeSetNameFromArn, stackNameFromArn } from '../../util/cloudformation';
import { waitFor } from '../../util/promises';
import type { ICloudFormationClient } from '../aws-auth/private';
import type { Diagnosis } from '../diagnosing/diagnosis';
import type { CloudFormationStackDiagnoser } from '../diagnosing/stack-diagnoser';
import type { IoHelper } from '../io/private';

export interface ChangeSetReport {
  readonly changeSet: DescribeChangeSetCommandOutput;
  readonly diagnosis: Diagnosis;
}

export interface ChangeSetDescriberProps {
  readonly cfn: ICloudFormationClient;
  readonly ioHelper: IoHelper;
  /**
   * The name or ARN of the stack the change set belongs to, prefer ARN.
   */
  readonly stackNameOrArn: string;
  /**
   * The name or ARN of the change set, prefer ARN.
   */
  readonly changeSetNameOrArn: string;
}

export interface WaitForChangeSetOptions {
  readonly diagnoser: CloudFormationStackDiagnoser;
}

/**
 * Describes a single CloudFormation change set.
 *
 * Change sets are described with `IncludePropertyValues`, which yields the before/after property
 * values and resource contexts that let `diff` surface changes invisible to a pure template diff.
 * CloudFormation may silently drop resource changes from such a response, in which case it says so
 * in `StatusReason`; we then describe the change set a second time without property values and put
 * back what was dropped. All pages of `Changes` are always fetched, so the change list is never
 * truncated. See https://github.com/aws/aws-cdk-cli/issues/1780
 */
export class ChangeSetDescriber {
  /**
   * Whether two change set change details describe the same change.
   *
   * This is the identity function for `mergeDescriptions`: a plain detail is only restored if no
   * detailed one matches it. Compares identifying fields only; value-carrying fields differ
   * between a description with and without `IncludePropertyValues`. `Target.Path` is deliberately
   * ignored: it only exists on detailed details, and a detailed response can carry several
   * path-level details for the same property name. A plain detail (which has no path) matching
   * any of them means the property is already covered; restoring it would duplicate the change.
   */
  private static describesSameChange(a: ResourceChangeDetail, b: ResourceChangeDetail): boolean {
    return a.Target?.Attribute === b.Target?.Attribute
      && a.Target?.Name === b.Target?.Name
      && a.ChangeSource === b.ChangeSource
      && a.CausingEntity === b.CausingEntity;
  }

  private readonly cfn: ICloudFormationClient;
  private readonly ioHelper: IoHelper;
  private readonly stackNameOrArn: string;
  private readonly changeSetNameOrArn: string;
  private readonly stackDisplayName: string;
  private readonly changeSetDisplayName: string;

  constructor(props: ChangeSetDescriberProps) {
    this.cfn = props.cfn;
    this.ioHelper = props.ioHelper;
    this.stackNameOrArn = props.stackNameOrArn;
    this.changeSetNameOrArn = props.changeSetNameOrArn;
    this.stackDisplayName = stackNameFromArn(props.stackNameOrArn);
    this.changeSetDisplayName = changeSetNameFromArn(props.changeSetNameOrArn);
  }

  /**
   * Waits for the change set to reach a terminal state (it stops being created), and describes it.
   *
   * Says nothing about whether the change set was created successfully; a failed change set is a
   * perfectly good return value here.
   */
  public async waitForSettled(): Promise<DescribeChangeSetCommandOutput> {
    await this.ioHelper.defaults.debug(format('Waiting for changeset %s on stack %s to finish creating...', this.changeSetDisplayName, this.stackDisplayName));
    const description = await waitFor(async () => {
      const current = await this.describeCurrentState();

      if (current.Status === 'CREATE_PENDING' || current.Status === 'CREATE_IN_PROGRESS') {
        await this.ioHelper.defaults.debug(format('Changeset %s on stack %s is still creating', this.changeSetDisplayName, this.stackDisplayName));
        return undefined;
      }

      return current;
    });

    if (!description) {
      throw new DeploymentError('Change set took too long to be created; aborting', 'ChangeSetTimeout');
    }

    return description;
  }

  /**
   * Waits for the change set to settle and diagnoses the outcome, without throwing.
   *
   * Use this if you want to inspect or report the problems yourself. If you just want the
   * operation to fail on a problem, use `waitAndThrowOnProblem`.
   */
  public async waitForReport(options: WaitForChangeSetOptions): Promise<ChangeSetReport> {
    const changeSet = await this.waitForSettled();
    const diagnosis = await options.diagnoser.diagnoseChangeSet(changeSet);
    return { changeSet, diagnosis };
  }

  /**
   * Waits for the change set to settle, and throws a `DeploymentError` if anything is wrong with it.
   *
   * Returns a change set that is either ready to be executed or that has no changes.
   */
  public async waitAndThrowOnProblem(options: WaitForChangeSetOptions): Promise<ChangeSetReport> {
    const report = await this.waitForReport(options);
    report.diagnosis.throwOnError();
    return report;
  }

  /**
   * Describes the change set as it is right now, for the purpose of executing it.
   *
   * Like `describeCurrentState` this does not wait; unlike it, the returned report is guaranteed to
   * describe a change set that can actually be executed. Use it for a change set that an earlier
   * command already created (and that may not even be ours), where blocking on it indefinitely
   * would be wrong: we report that it isn't ready instead.
   */
  public async describeForExecution(options: WaitForChangeSetOptions): Promise<ChangeSetReport> {
    const changeSet = await this.describeCurrentState();
    const diagnosis = await options.diagnoser.diagnoseChangeSet(changeSet, { requireExecutable: true });
    diagnosis.throwOnError();
    return { changeSet, diagnosis };
  }

  /**
   * Waits for the change set to be gone (deleted, or never existed).
   */
  public async waitForGone(): Promise<void> {
    await this.ioHelper.defaults.debug(format('Waiting for changeset %s on stack %s to finish deleting...', this.changeSetDisplayName, this.stackDisplayName));
    await waitFor(async () => {
      try {
        const description = await this.cfn.describeChangeSet({
          StackName: this.stackNameOrArn,
          ChangeSetName: this.changeSetNameOrArn,
        });

        if (description.Status === ChangeSetStatus.DELETE_COMPLETE || description.Status === ChangeSetStatus.DELETE_FAILED) {
          return true;
        }

        return undefined;
      } catch (e: any) {
        if (e.name === 'ChangeSetNotFoundException') {
          return true;
        }
        throw e;
      }
    });
  }

  /**
   * Describe the change set as it is right now, without waiting for it to settle.
   *
   * Only use this for a change set that is already known to be in a terminal state (for example
   * one that has already been waited for, or one that is being diagnosed after it failed). If the
   * change set may still be creating, use `waitForSettled` or `waitAndThrowOnProblem` instead.
   */
  public async describeCurrentState(): Promise<DescribeChangeSetCommandOutput> {
    const detailed = await this.describeOnce(true);

    // When the change set is pending, we never have changes so no need to try and recover missing ones.
    if (detailed.Status === ChangeSetStatus.CREATE_PENDING || detailed.Status === ChangeSetStatus.CREATE_IN_PROGRESS) {
      return detailed;
    }

    // CloudFormation warned us that it left data out, so describe again without property values
    // and put back whatever it dropped.
    if (hasIncompletePropertyValuesWarning(detailed)) {
      await this.ioHelper.defaults.debug(format(
        'Changeset %s on stack %s was described with incomplete data (%s); describing it again without property values to recover what was dropped',
        this.changeSetDisplayName, this.stackDisplayName, detailed.StatusReason,
      ));
      return this.mergeDescriptions(detailed, await this.describeOnce(false));
    }

    return detailed;
  }

  private async describeOnce(includePropertyValues: boolean): Promise<DescribeChangeSetCommandOutput> {
    const response = await this.cfn.describeChangeSet({
      StackName: this.stackNameOrArn,
      ChangeSetName: this.changeSetNameOrArn,
      IncludePropertyValues: includePropertyValues,
    });

    // Traverse all pages, so that `Changes` is always the complete set of changes. A truncated
    // list would silently make callers believe a resource is unchanged.
    while (response.NextToken != null) {
      const nextPage = await this.cfn.describeChangeSet({
        StackName: response.StackId ?? this.stackNameOrArn,
        ChangeSetName: response.ChangeSetId ?? this.changeSetNameOrArn,
        NextToken: response.NextToken,
        IncludePropertyValues: includePropertyValues,
      });

      // Consolidate the changes
      if (nextPage.Changes != null) {
        response.Changes = response.Changes != null ? response.Changes.concat(nextPage.Changes) : nextPage.Changes;
      }

      // Forward the new NextToken
      response.NextToken = nextPage.NextToken;
    }

    return response;
  }

  /**
   * Merge two descriptions of the same change set: one described with `IncludePropertyValues`
   * (detailed) and one described without (plain).
   *
   * CloudFormation can silently drop a `ResourceChange` from the detailed response when it
   * fails to render property values (e.g. JSON-typed properties). The detailed description is
   * used as the base; resource changes and details only present in the plain one are restored.
   *
   * See https://github.com/aws/aws-cdk-cli/issues/1780
   */
  private mergeDescriptions(
    detailed: DescribeChangeSetCommandOutput,
    plain: DescribeChangeSetCommandOutput,
  ): DescribeChangeSetCommandOutput {
    // Shallow-copy the changes so we can add details without mutating the input
    const changes: Change[] = (detailed.Changes ?? []).map((change) => ({
      ...change,
      ResourceChange: change.ResourceChange ? { ...change.ResourceChange } : undefined,
    }));

    const changesByLogicalId = new Map<string, Change>();
    for (const change of changes) {
      if (change.ResourceChange?.LogicalResourceId) {
        changesByLogicalId.set(change.ResourceChange.LogicalResourceId, change);
      }
    }

    for (const change of plain.Changes ?? []) {
      const logicalId = change.ResourceChange?.LogicalResourceId;
      if (!logicalId) {
        // Cannot correlate without a logical id; skip rather than risk duplicating.
        continue;
      }

      const existing = changesByLogicalId.get(logicalId);
      if (!existing?.ResourceChange) {
        // Dropped from the detailed response; restore it.
        changes.push(change);
        continue;
      }

      // Present in both; restore any details dropped from the detailed response.
      const existingDetails = existing.ResourceChange.Details ?? [];
      const droppedDetails = (change.ResourceChange?.Details ?? []).filter(
        (detail) => !existingDetails.some((existingDetail) => ChangeSetDescriber.describesSameChange(existingDetail, detail)),
      );
      if (droppedDetails.length > 0) {
        existing.ResourceChange.Details = [...existingDetails, ...droppedDetails];
      }
    }

    // Take the status reason from the plain response: the detailed one is the incomplete-data
    // warning, which would otherwise displace the real reason (for example the
    // `AWS::EarlyValidation` marker that tells us why a change set failed to create).
    return { ...detailed, StatusReason: plain.StatusReason ?? detailed.StatusReason, Changes: changes };
  }
}

/**
 * The marker CloudFormation puts in `StatusReason` when it left data out of a response that was
 * requested with `IncludePropertyValues`.
 *
 * It only says this when it actually dropped something, and names the resources it gave up on.
 * `Status` is `CREATE_COMPLETE` either way, so this is the only signal we get:
 *
 * ```
 * [WARN] --include-property-values option can return incomplete ChangeSet data because: Logical Id: MyResource, failed property validation
 * ```
 */
const INCOMPLETE_PROPERTY_VALUES_WARNING = '[WARN] --include-property-values option can return incomplete ChangeSet data';

/**
 * Whether CloudFormation flagged this description as potentially missing data.
 *
 * See https://github.com/aws/aws-cdk-cli/issues/1780
 */
function hasIncompletePropertyValuesWarning(description: DescribeChangeSetCommandOutput): boolean {
  return description.StatusReason?.includes(INCOMPLETE_PROPERTY_VALUES_WARNING) ?? false;
}
