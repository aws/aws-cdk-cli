import { ToolkitError } from '../../../toolkit/toolkit-error';

export { CloudFormationGraph } from './graph';
export { CloudFormationParser } from './parser';
export { CloudFormationGenerator } from './generator';
export * from './types';

// Utility functions for working with node locations
export function parseNodeId(qualifiedId: string): { stackId: string; logicalId: string } {
  const parts = qualifiedId.split('.');
  if (parts.length < 2) {
    throw new ToolkitError(`Invalid qualified ID: ${qualifiedId}`);
  }
  return {
    stackId: parts[0],
    logicalId: parts.slice(1).join('.')
  };
}

export function createNodeId(stackId: string, logicalId: string): string {
  return `${stackId}.${logicalId}`;
}
