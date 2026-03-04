import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import type { Tag } from '../tags';

/**
 * @returns an array with the tags available in the stack metadata.
 */
export function tagsForStack(stack: cxapi.CloudFormationStackArtifact): Tag[] {
  return Object.entries(stack.tags).map(([Key, Value]) => ({ Key, Value }));
}
