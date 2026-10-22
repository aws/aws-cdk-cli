import { ResourceImpact, type TemplateDiff } from '@aws-cdk/cloudformation-diff';
import picomatch from 'picomatch';
import type { DestructiveChange } from '../../payloads/diff';
import { ToolkitError } from '../../toolkit/toolkit-error';

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
 * Check that the patterns to ignore destructive changes with are a list of non-empty strings
 *
 * The patterns come from user input, such as `cdk.json`, so their type is not guaranteed.
 * A number is turned into a string, because a command line parser may read a pattern like `123` as a number.
 * A pattern starting with `!` (also after leading `.` or `/` characters) is rejected: as a glob it would negate the match and ignore
 * every other change, so it is also matched with negation turned off. Leading or trailing whitespace is rejected too,
 * since it is most likely a mistake that would make the pattern match nothing.
 *
 * @returns the patterns, or `undefined` if none are given
 */
export function validateIgnoreDestructivePatterns(patterns: unknown): string[] | undefined {
  if (patterns === undefined) {
    return undefined;
  }
  if (!Array.isArray(patterns)) {
    throw new ToolkitError(
      'InvalidIgnoreDestructivePattern',
      `"ignoreDestructive" must be a list of patterns, got ${JSON.stringify(patterns)}`,
    );
  }
  return patterns.map((pattern) => {
    const value = typeof pattern === 'number' ? String(pattern) : pattern;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ToolkitError(
        'InvalidIgnoreDestructivePattern',
        `each pattern of "ignoreDestructive" (--ignore-destructive) must be a non-empty string, got ${JSON.stringify(pattern)}`,
      );
    }
    if (value !== value.trim()) {
      throw new ToolkitError(
        'InvalidIgnoreDestructivePattern',
        `a pattern of "ignoreDestructive" (--ignore-destructive) cannot start or end with whitespace, got ${JSON.stringify(value)}`,
      );
    }
    if (/^[./]*!/.test(value)) {
      throw new ToolkitError(
        'InvalidIgnoreDestructivePattern',
        `a pattern of "ignoreDestructive" (--ignore-destructive) cannot start with "!", got ${JSON.stringify(value)}; negated patterns are not supported, list the resources to ignore instead`,
      );
    }
    if (/^\/*$/.test(value)) {
      throw new ToolkitError(
        'InvalidIgnoreDestructivePattern',
        `a pattern of "ignoreDestructive" (--ignore-destructive) must name a resource type or a construct path, got ${JSON.stringify(value)}`,
      );
    }
    return value;
  });
}

/**
 * Destructive changes split by whether they match an ignore pattern
 */
export interface PartitionedDestructiveChanges {
  /**
   * Changes that do not match any ignore pattern
   */
  readonly destructive: DestructiveChange[];

  /**
   * Changes that match at least one ignore pattern
   */
  readonly ignored: DestructiveChange[];
}

/**
 * Split destructive changes by whether they match one of the given ignore patterns
 *
 * Each pattern is a glob, and its form decides what it is matched against:
 *
 * - contains `::` (`AWS::ApiGateway::Deployment`, `AWS::Lambda::*`): the resource type
 * - anything else: the construct path, in full (`MyStack/MyApi/Deployment/Resource`), without a trailing
 *   `Resource` or `Default` (`MyStack/MyApi/Deployment`), or as shown in the `cdk diff` output, which also
 *   leaves out the stack (`MyApi/Deployment`)
 *
 * Logical IDs are not supported: resources that are replaced by design get a new logical ID on every change.
 */
export function partitionDestructiveChanges(changes: DestructiveChange[], ignorePatterns: string[] = []): PartitionedDestructiveChanges {
  if (ignorePatterns.length === 0) {
    return { destructive: changes, ignored: [] };
  }
  const isIgnored = destructiveChangeMatcher(ignorePatterns);
  return {
    destructive: changes.filter(c => !isIgnored(c)),
    ignored: changes.filter(isIgnored),
  };
}

function destructiveChangeMatcher(patterns: string[]): (change: DestructiveChange) => boolean {
  const byType: string[] = [];
  const byPath: string[] = [];
  // The CLI validates the patterns when it reads them, but check again for other callers
  for (const pattern of validateIgnoreDestructivePatterns(patterns) ?? []) {
    if (pattern.includes('::')) {
      byType.push(pattern);
    } else {
      byPath.push(pattern.replace(/^\/|\/$/g, ''));
    }
  }

  const options: picomatch.PicomatchOptions = { dot: true, nonegate: true };
  const matchType = byType.length > 0 ? picomatch(byType, options) : () => false;
  const matchPath = byPath.length > 0 ? picomatch(byPath, options) : () => false;

  return (change) => {
    if (change.resourceType && matchType(change.resourceType)) {
      return true;
    }
    if (change.constructPath) {
      const fullPath = change.constructPath.replace(/^\//, '');
      // Like the diff output, keep a default child directly under the stack, so that a stack name does not match it
      const fullPathWithoutDefaultChild = fullPath.split('/').length > 2 ? withoutDefaultChild(fullPath) : fullPath;
      return [fullPath, fullPathWithoutDefaultChild, displayPath(fullPath)].some(p => matchPath(p));
    }
    return false;
  };
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
  const parts = constructPath.replace(/^\//, '').split('/');
  return parts.length > 1 ? withoutDefaultChild(parts.slice(1).join('/')) : parts.join('/');
}

/**
 * Remove a trailing `Resource` or `Default` component, which names the default child of a construct
 */
function withoutDefaultChild(constructPath: string): string {
  const parts = constructPath.split('/');
  return parts.length > 1 && ['Resource', 'Default'].includes(parts[parts.length - 1])
    ? parts.slice(0, -1).join('/')
    : constructPath;
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
