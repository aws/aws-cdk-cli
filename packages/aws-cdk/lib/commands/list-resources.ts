import type { ResourceDetails, ResourceExplainDetails } from '@aws-cdk/toolkit-lib';
import type { CdkToolkit } from '../cli/cdk-toolkit';
import { DefaultSelection, ExtendedStackSelection } from '../cxapp';

const PATH_METADATA_KEY = 'aws:cdk:path';

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
   * Stack selector (name or pattern)
   */
  readonly selector: string;

  /**
   * Filter by resource type (e.g., AWS::Lambda::Function)
   */
  readonly type?: string;

  /**
   * Include all resources (including hidden types like Lambda::Permission)
   */
  readonly all?: boolean;
}

/**
 * List all resources in a stack
 */
export async function listResources(
  toolkit: CdkToolkit,
  options: ListResourcesOptions,
): Promise<ResourceDetails[]> {
  const assembly = await toolkit.assembly();

  const stacks = await assembly.selectStacks(
    { patterns: [options.selector] },
    {
      extend: ExtendedStackSelection.None,
      defaultBehavior: DefaultSelection.OnlySingle,
    },
  );

  if (stacks.stackCount === 0) {
    return [];
  }

  const resources: ResourceDetails[] = [];

  for (const stack of stacks.stackArtifacts) {
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
        dependsOn: Array.isArray(resourceObj.DependsOn)
          ? resourceObj.DependsOn
          : resourceObj.DependsOn
            ? [resourceObj.DependsOn]
            : [],
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
 */
export async function explainResource(
  toolkit: CdkToolkit,
  options: ListResourcesOptions & { logicalId: string },
): Promise<ResourceExplainDetails | undefined> {
  const assembly = await toolkit.assembly();

  const stacks = await assembly.selectStacks(
    { patterns: [options.selector] },
    {
      extend: ExtendedStackSelection.None,
      defaultBehavior: DefaultSelection.OnlySingle,
    },
  );

  if (stacks.stackCount === 0) {
    return undefined;
  }

  const stack = stacks.firstStack;
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
    dependsOn: Array.isArray(resource.DependsOn)
      ? resource.DependsOn
      : resource.DependsOn
        ? [resource.DependsOn]
        : [],
    imports: extractImportValues(resource),
    removalPolicy: mapDeletionPolicy(resource.DeletionPolicy),
    condition: resource.Condition,
    updatePolicy: resource.UpdatePolicy ? JSON.stringify(resource.UpdatePolicy) : undefined,
    creationPolicy: resource.CreationPolicy ? JSON.stringify(resource.CreationPolicy) : undefined,
  };
}

/**
 * Extract Fn::ImportValue references from a resource
 */
function extractImportValues(resource: any): string[] {
  const imports: string[] = [];

  function walk(obj: any) {
    if (obj === null || obj === undefined) return;

    if (typeof obj === 'object') {
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
    } else if (Array.isArray(obj)) {
      for (const item of obj) {
        walk(item);
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
  if (result.endsWith('/Resource')) {
    result = result.slice(0, -9);
  }

  return result;
}
