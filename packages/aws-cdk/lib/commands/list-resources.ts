import type { ResourceDetails, ResourceExplainDetails } from '@aws-cdk/toolkit-lib';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { minimatch } from 'minimatch';
import type { CdkToolkit } from '../cli/cdk-toolkit';
import { DefaultSelection, ExtendedStackSelection } from '../cxapp';

const PATH_METADATA_KEY = 'aws:cdk:path';
const RESOURCE_SUFFIX = '/Resource';

/**
 * Resource types that are hidden by default (noisy/derivative resources)
 */
const HIDDEN_RESOURCE_TYPES = [
  'AWS::Lambda::Permission',
];

/**
 * Options for listing resources
 */
export interface ListResourcesOptions {
  /**
   * Stack selectors (names or patterns)
   */
  readonly selectors: string[];

  /**
   * Filter by resource type (e.g., AWS::Lambda::Function)
   */
  readonly type?: string;

  /**
   * Include all resources (including hidden types like Lambda::Permission)
   */
  readonly all?: boolean;

  /**
   * Use case-insensitive matching for stack name patterns
   */
  readonly ignoreCase?: boolean;
}

/**
 * List all resources in the specified stack(s)
 */
export async function listResources(
  toolkit: CdkToolkit,
  options: ListResourcesOptions,
): Promise<ResourceDetails[]> {
  const assembly = await toolkit.assembly();

  // When ignoreCase is true, we get all stacks and filter manually with case-insensitive matching
  const useManualFiltering = options.ignoreCase && options.selectors.length > 0;

  const stacks = await assembly.selectStacks(
    { patterns: useManualFiltering ? [] : options.selectors },
    {
      extend: ExtendedStackSelection.None,
      defaultBehavior: DefaultSelection.AllStacks,
    },
  );

  if (stacks.stackCount === 0) {
    return [];
  }

  // Filter stacks manually when using case-insensitive matching
  let stackArtifacts = stacks.stackArtifacts;
  if (useManualFiltering) {
    stackArtifacts = stackArtifacts.filter(stack =>
      options.selectors.some(pattern =>
        minimatch(stack.hierarchicalId, pattern, { nocase: true }),
      ),
    );
    if (stackArtifacts.length === 0) {
      return [];
    }
  }

  const resources: ResourceDetails[] = [];

  for (const stack of stackArtifacts) {
    const template = stack.template;
    const templateResources = template.Resources ?? {};

    for (const [logicalId, resource] of Object.entries(templateResources)) {
      const resourceObj = resource as any;
      const resourceType = resourceObj.Type ?? '<unknown>';

      // Filter by type if specified (case-insensitive partial match)
      if (options.type && !resourceType.toLowerCase().includes(options.type.toLowerCase())) {
        continue;
      }

      // Hide noisy resource types by default (unless --all or explicitly filtering for them)
      if (!options.all && !options.type && HIDDEN_RESOURCE_TYPES.includes(resourceType)) {
        continue;
      }

      // Strip stack name prefix from construct path
      const fullPath = resourceObj.Metadata?.[PATH_METADATA_KEY] ?? '<unknown>';
      const constructPath = stripStackPrefix(fullPath, stack.id);

      resources.push({
        stackId: stack.id,
        logicalId,
        type: resourceType,
        constructPath,
        dependsOn: normalizeDependsOn(resourceObj.DependsOn),
        imports: extractImportValues(resourceObj),
        removalPolicy: mapDeletionPolicy(resourceObj.DeletionPolicy),
      });
    }
  }

  // Sort by type first, then by logical ID
  resources.sort((a, b) => {
    const typeCompare = a.type.localeCompare(b.type);
    if (typeCompare !== 0) return typeCompare;
    return a.logicalId.localeCompare(b.logicalId);
  });

  return resources;
}

/**
 * Get detailed information about a specific resource
 * Note: --explain requires a single stack to be selected
 */
export async function explainResource(
  toolkit: CdkToolkit,
  options: ListResourcesOptions & { logicalId: string },
): Promise<ResourceExplainDetails | undefined> {
  const assembly = await toolkit.assembly();

  // When ignoreCase is true, we get all stacks and filter manually with case-insensitive matching
  const useManualFiltering = options.ignoreCase && options.selectors.length > 0;

  const stacks = await assembly.selectStacks(
    { patterns: useManualFiltering ? [] : options.selectors },
    {
      extend: ExtendedStackSelection.None,
      defaultBehavior: useManualFiltering ? DefaultSelection.AllStacks : DefaultSelection.OnlySingle,
    },
  );

  if (stacks.stackCount === 0) {
    return undefined;
  }

  // Filter stacks manually when using case-insensitive matching
  let stack = stacks.firstStack;
  if (useManualFiltering) {
    const matchingStacks = stacks.stackArtifacts.filter(s =>
      options.selectors.some(pattern =>
        minimatch(s.hierarchicalId, pattern, { nocase: true }),
      ),
    );
    if (matchingStacks.length === 0) {
      return undefined;
    }
    if (matchingStacks.length > 1) {
      throw new ToolkitError(`--explain requires exactly one stack, but found ${matchingStacks.length} matching stacks`);
    }
    stack = matchingStacks[0];
  }

  const template = stack.template;
  const resource = template.Resources?.[options.logicalId] as any;

  if (!resource) {
    return undefined;
  }

  // Strip stack name prefix from construct path
  const fullPath = resource.Metadata?.[PATH_METADATA_KEY] ?? '<unknown>';
  const constructPath = stripStackPrefix(fullPath, stack.id);

  return {
    stackId: stack.id,
    logicalId: options.logicalId,
    type: resource.Type ?? '<unknown>',
    constructPath,
    dependsOn: normalizeDependsOn(resource.DependsOn),
    imports: extractImportValues(resource),
    removalPolicy: mapDeletionPolicy(resource.DeletionPolicy),
    condition: resource.Condition,
    updatePolicy: resource.UpdatePolicy ? JSON.stringify(resource.UpdatePolicy) : undefined,
    creationPolicy: resource.CreationPolicy ? JSON.stringify(resource.CreationPolicy) : undefined,
  };
}

/**
 * Normalize DependsOn to always be an array
 */
function normalizeDependsOn(dependsOn: unknown): string[] {
  if (Array.isArray(dependsOn)) return dependsOn;
  if (dependsOn) return [dependsOn as string];
  return [];
}

/**
 * Extract Fn::ImportValue references from a resource
 */
function extractImportValues(resource: any): string[] {
  const imports: string[] = [];

  function walk(obj: any) {
    if (obj === null || obj === undefined) return;

    // Check array first since Array.isArray is more specific than typeof === 'object'
    if (Array.isArray(obj)) {
      for (const item of obj) {
        walk(item);
      }
    } else if (typeof obj === 'object') {
      if ('Fn::ImportValue' in obj) {
        const importRef = obj['Fn::ImportValue'];
        if (typeof importRef === 'string') {
          imports.push(importRef);
        } else if (typeof importRef === 'object' && 'Fn::Sub' in importRef) {
          imports.push(`\${${importRef['Fn::Sub']}}`);
        }
      }

      for (const value of Object.values(obj)) {
        walk(value);
      }
    }
  }

  walk(resource.Properties);
  return imports;
}

/**
 * Map CloudFormation DeletionPolicy to removal policy
 */
function mapDeletionPolicy(policy?: string): 'retain' | 'destroy' | 'snapshot' | undefined {
  switch (policy) {
    case 'Retain': return 'retain';
    case 'Delete': return 'destroy';
    case 'Snapshot': return 'snapshot';
    default: return undefined;
  }
}

/**
 * Strip the stack name prefix and /Resource suffix from a construct path
 * e.g., "WebhookDeliveryStack/ReceiverApi/Account" -> "ReceiverApi/Account"
 * e.g., "WebhookDeliveryStack/ApiLambda/Resource" -> "ApiLambda"
 */
function stripStackPrefix(path: string, stackId: string): string {
  if (path === '<unknown>') return path;

  let result = path;

  // Strip stack prefix
  const prefix = `${stackId}/`;
  if (result.startsWith(prefix)) {
    result = result.slice(prefix.length);
  }

  // Strip /Resource suffix (common CDK L2 pattern)
  if (result.endsWith(RESOURCE_SUFFIX)) {
    result = result.slice(0, -RESOURCE_SUFFIX.length);
  }

  return result;
}
