import type { ResourceDifference } from '@aws-cdk/cloudformation-diff';
import { ToolkitError } from '@aws-cdk/toolkit-lib';

/**
 * Represents a resource filter pattern
 */
export interface ResourceFilter {
  /**
   * The resource type pattern (e.g., 'AWS::Lambda::Function')
   */
  resourceType: string;

  /**
   * Optional property path (e.g., 'Properties.Code.S3Key')
   */
  propertyPath?: string;
}

/**
 * Parses a filter string into a ResourceFilter object
 */
export function parseResourceFilter(filter: string): ResourceFilter {
  const parts = filter.split('.');
  const resourceType = parts[0];

  if (!resourceType) {
    throw new ToolkitError(`Invalid resource filter: '${filter}'. Must specify at least a resource type.`);
  }

  const propertyPath = parts.length > 1 ? parts.slice(1).join('.') : undefined;

  return {
    resourceType,
    propertyPath,
  };
}

/**
 * Checks if a resource type matches a filter pattern
 */
export function matchesResourceType(resourceType: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }

  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return resourceType.startsWith(prefix);
  }

  return resourceType === pattern;
}

/**
 * Checks if a property change matches a filter
 */
export function matchesPropertyFilter(
  resourceType: string,
  propertyName: string,
  filter: ResourceFilter,
): boolean {
  // First check if resource type matches
  if (!matchesResourceType(resourceType, filter.resourceType)) {
    return false;
  }

  // If no property path specified in filter, any property change is allowed
  if (!filter.propertyPath) {
    return true;
  }

  // Check if the property path matches
  const filterPath = filter.propertyPath.startsWith('Properties.')
    ? filter.propertyPath.slice('Properties.'.length)
    : filter.propertyPath;

  return propertyName === filterPath || propertyName.startsWith(filterPath + '.');
}

/**
 * Validates resource changes against allowed filters
 */
export function validateResourceChanges(
  resourceChanges: { [logicalId: string]: ResourceDifference },
  allowedFilters: string[],
): { isValid: boolean; violations: string[] } {
  if (allowedFilters.length === 0) {
    return { isValid: true, violations: [] };
  }

  const filters = allowedFilters.map(parseResourceFilter);
  const violations: string[] = [];

  for (const [logicalId, change] of Object.entries(resourceChanges)) {
    const resourceType = change.resourceType;

    if (!resourceType) {
      continue;
    }

    // Check if the resource type change itself is allowed
    let resourceTypeAllowed = false;
    for (const filter of filters) {
      if (matchesResourceType(resourceType, filter.resourceType) && !filter.propertyPath) {
        resourceTypeAllowed = true;
        break;
      }
    }

    // If it's a resource addition/removal, check resource type level permission
    if (change.isAddition || change.isRemoval) {
      if (!resourceTypeAllowed) {
        const action = change.isAddition ? 'addition' : 'removal';
        violations.push(`${logicalId} (${resourceType}): ${action} not allowed by filters`);
      }
      continue;
    }

    // For updates, check each property change
    const propertyUpdates = change.propertyUpdates;
    for (const [propertyName] of Object.entries(propertyUpdates)) {
      let propertyAllowed = false;

      for (const filter of filters) {
        if (matchesPropertyFilter(resourceType, propertyName, filter)) {
          propertyAllowed = true;
          break;
        }
      }

      if (!propertyAllowed) {
        violations.push(`${logicalId} (${resourceType}): property '${propertyName}' change not allowed by filters`);
      }
    }

    // Check other changes (non-property changes)
    const otherChanges = change.otherChanges;
    if (Object.keys(otherChanges).length > 0 && !resourceTypeAllowed) {
      violations.push(`${logicalId} (${resourceType}): non-property changes not allowed by filters`);
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}

/**
 * Formats violation messages for display to the user
 */
export function formatViolationMessage(
  violations: string[],
  allowedFilters: string[],
): string {
  const lines = [
    '❌ Deployment aborted: Detected changes to resources outside allowed filters',
    '',
    'Allowed resource changes:',
    ...allowedFilters.map(filter => `  • ${filter}`),
    '',
    'Detected changes that violate the filter:',
    ...violations.map(violation => `  • ${violation}`),
    '',
    'To proceed with these changes, either:',
    '  1. Review and remove the unwanted changes from your CDK code',
    '  2. Update your --allow-resource-changes filters to include these resource types',
    '  3. Remove the --allow-resource-changes option to deploy all changes',
  ];

  return lines.join('\n');
}
