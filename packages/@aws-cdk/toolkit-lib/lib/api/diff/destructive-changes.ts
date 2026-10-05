import { ResourceImpact, type Move, type TemplateDiff } from '@aws-cdk/cloudformation-diff';

/**
 * A resource change that replaces, deletes or orphans an existing physical resource
 */
export interface DestructiveChange {
  /**
   * The name of the stack (or nested stack) that contains the resource
   */
  readonly stackName: string;

  /**
   * The logical ID of the resource
   */
  readonly logicalId: string;

  /**
   * The CloudFormation resource type, if known
   */
  readonly resourceType?: string;

  /**
   * The construct path of the resource
   *
   * @default - no construct path is known for the resource
   */
  readonly constructPath?: string;

  /**
   * The impact of the change on the existing physical resource
   */
  readonly impact: ResourceImpact;

  /**
   * Where the resource was moved to, if the change was detected as a move (`--include-moves`)
   *
   * A deployment still destroys or orphans the resource unless it is moved with `cdk refactor` first.
   *
   * @default - the resource was not moved
   */
  readonly move?: Move;
}

/**
 * Resource types that are not physical resources, so removing or replacing them is never destructive
 */
const IGNORED_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  'AWS::CDK::Metadata',
]);

const PATH_METADATA_KEY = 'aws:cdk:path';

const DESTRUCTIVE_IMPACTS: ReadonlySet<ResourceImpact> = new Set([
  ResourceImpact.WILL_REPLACE,
  ResourceImpact.MAY_REPLACE,
  ResourceImpact.WILL_DESTROY,
  ResourceImpact.WILL_ORPHAN,
]);

/**
 * Collect the resource changes that replace, delete or orphan an existing physical resource
 *
 * @param templateDiffs - template diffs indexed by stack name, as returned by `DiffFormatter.displayedDiffs`
 * @param constructPaths - construct paths indexed by stack name and logical ID, as returned by `DiffFormatter.constructPaths`.
 *   Resources without an entry fall back to their `aws:cdk:path` metadata.
 */
export function findDestructiveChanges(
  templateDiffs: Record<string, TemplateDiff>,
  constructPaths: Record<string, Record<string, string>> = {},
): DestructiveChange[] {
  const changes: DestructiveChange[] = [];
  for (const [stackName, templateDiff] of Object.entries(templateDiffs)) {
    templateDiff.resources.forEachDifference((logicalId, change) => {
      // `changeImpact` also covers removals: WILL_DESTROY, or WILL_ORPHAN for a resource with DeletionPolicy: Retain
      const resourceType = change.oldResourceType ?? change.newResourceType;
      const constructPath = constructPaths[stackName]?.[logicalId]
        ?? change.newValue?.Metadata?.[PATH_METADATA_KEY]
        ?? change.oldValue?.Metadata?.[PATH_METADATA_KEY];
      if (resourceType && IGNORED_RESOURCE_TYPES.has(resourceType)) {
        return;
      }
      if (DESTRUCTIVE_IMPACTS.has(change.changeImpact)) {
        changes.push({
          stackName,
          logicalId,
          resourceType,
          ...(constructPath ? { constructPath } : {}),
          impact: change.changeImpact,
          ...(change.move ? { move: change.move } : {}),
        });
      }
    });
  }
  return changes;
}

/**
 * Format a destructive change as a single line for the user
 *
 * The resource is shown the same way as in the `cdk diff` output: resource type, construct path and logical ID.
 */
export function formatDestructiveChange(change: DestructiveChange): string {
  const resourceType = change.resourceType ? `${change.resourceType} ` : '';
  const constructPath = change.constructPath ? `${displayPath(change.constructPath)} ` : '';
  const move = change.move
    ? ` (moved to ${change.move.stackName}.${change.move.resourceLogicalId}, run 'cdk refactor' to keep it)`
    : '';
  return `${change.stackName}: ${resourceType}${constructPath}${change.logicalId} ${describeDestructiveImpact(change.impact)}${move}`;
}

/**
 * Shorten a construct path the same way the `cdk diff` output does
 *
 * The stack is left out (it is shown separately), as is a trailing `Resource` or `Default` component.
 */
function displayPath(constructPath: string): string {
  let parts = constructPath.replace(/^\//, '').split('/');
  if (parts.length > 1) {
    parts = parts.slice(1);
    if (parts.length > 1 && ['Resource', 'Default'].includes(parts[parts.length - 1])) {
      parts = parts.slice(0, -1);
    }
  }
  return parts.join('/');
}

/**
 * Describe the impact of a destructive change in a few words
 */
export function describeDestructiveImpact(impact: ResourceImpact): string {
  switch (impact) {
    case ResourceImpact.WILL_REPLACE:
      return 'will be replaced';
    case ResourceImpact.MAY_REPLACE:
      return 'may be replaced';
    case ResourceImpact.WILL_DESTROY:
      return 'will be destroyed';
    case ResourceImpact.WILL_ORPHAN:
      return 'will be orphaned';
    default:
      return impact;
  }
}
