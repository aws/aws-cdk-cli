import { format } from 'node:util';
import type { DeploymentConfig, DescribeChangeSetCommandOutput } from '@aws-sdk/client-cloudformation';
import { ChangeSetDescriber } from './change-set-describer';
import type { ReplacedResource } from '../../payloads/deploy';
import { formatErrorMessage } from '../../util';
import type { ICloudFormationClient } from '../aws-auth/private';
import type { IoHelper } from '../io/private';

/**
 * The outcome of scanning a change set hierarchy for replacements.
 *
 * `uninspected` is non-empty when part of the hierarchy could not be read, in which case an empty `replacements`
 * does NOT mean there are none.
 */
export interface ReplacementScan {
  readonly replacements: ReplacedResource[];
  readonly uninspected: string[];
}

export interface FindAllReplacementsOptions {
  readonly cfn: ICloudFormationClient;
  readonly ioHelper: IoHelper;
}

const MAX_NESTED_CHANGE_SET_DEPTH = 10;

/**
 * Scan a change set and the change sets of all nested stacks below it for resources that CloudFormation would
 * replace.
 *
 * Nested stack changes carry their own change set, so a replacement can hide arbitrarily deep in the hierarchy;
 * each one is described in turn. The traversal is bounded by `MAX_NESTED_CHANGE_SET_DEPTH` and by a visited set
 * keyed on change set id, so a hierarchy that refers back to itself is cut short rather than walked to the cap.
 *
 * This is fail-closed: anything that could not be read is reported in `uninspected` rather than silently treated
 * as having no replacement. Callers must not read an empty `replacements` as proof that there are none without
 * also checking `uninspected`.
 */
export async function findAllReplacements(
  changeSet: DescribeChangeSetCommandOutput,
  options: FindAllReplacementsOptions,
): Promise<ReplacementScan> {
  const visited = new Set<string>();
  const uninspected: string[] = [];

  const collect = async (current: DescribeChangeSetCommandOutput, depth: number): Promise<ReplacedResource[]> => {
    const replacements = findReplacements(current);
    const nestedStackChanges = (current.Changes ?? [])
      .map((change) => change.ResourceChange)
      .filter((nested) => nested?.ResourceType === 'AWS::CloudFormation::Stack')
      .filter((nested) => nested!.Action !== 'Remove');

    if (nestedStackChanges.length > 0 && depth >= MAX_NESTED_CHANGE_SET_DEPTH) {
      uninspected.push(format(
        'nested stacks below depth %d (%s) were not inspected',
        depth,
        nestedStackChanges.map((nested) => nested!.LogicalResourceId ?? '<unnamed>').join(', '),
      ));
      return replacements;
    }

    for (const nested of nestedStackChanges) {
      const logicalId = nested!.LogicalResourceId ?? '<unnamed>';

      if (!nested!.ChangeSetId) {
        uninspected.push(format('nested stack %s reported no change set to inspect', logicalId));
        continue;
      }

      if (visited.has(nested!.ChangeSetId)) {
        continue;
      }
      visited.add(nested!.ChangeSetId);

      let child: DescribeChangeSetCommandOutput;
      try {
        child = await new ChangeSetDescriber({
          cfn: options.cfn,
          ioHelper: options.ioHelper,
          stackNameOrArn: nested!.PhysicalResourceId ?? logicalId,
          changeSetNameOrArn: nested!.ChangeSetId,
        }).waitForSettled();
      } catch (e: any) {
        uninspected.push(format('nested stack %s could not be described (%s)', logicalId, formatErrorMessage(e)));
        continue;
      }

      if (child.Status !== 'CREATE_COMPLETE') {
        uninspected.push(format(
          'nested stack %s has change set status %s, so its changes could not be read',
          logicalId,
          child.Status ?? '<unknown>',
        ));
        continue;
      }

      replacements.push(...await collect(child, depth + 1));
    }

    return replacements;
  };

  return { replacements: await collect(changeSet, 0), uninspected };
}

/**
 * Find the resource changes in a change set that CloudFormation would perform by replacement
 */
export function findReplacements(changeSet: DescribeChangeSetCommandOutput): ReplacedResource[] {
  return (changeSet.Changes ?? []).flatMap((c) => {
    const change = c.ResourceChange;
    const policyAction = change?.PolicyAction;
    const replacesResource = policyAction === 'ReplaceAndDelete'
      || policyAction === 'ReplaceAndRetain'
      || policyAction === 'ReplaceAndSnapshot';

    if (!change || !replacesResource) {
      return [];
    }

    return [{
      logicalId: change.LogicalResourceId,
      resourceType: change.ResourceType,
      replacement: change.Replacement,
      policyAction,
    }];
  });
}

/**
 * Whether a persisted change set `DeploymentConfig` pins the rollback choice, and if so which way.
 */
export function expressRollbackDisabled(config: DeploymentConfig | undefined): boolean | undefined {
  if (config?.Mode !== 'EXPRESS') {
    return undefined;
  }
  return config.DisableRollback !== false;
}
