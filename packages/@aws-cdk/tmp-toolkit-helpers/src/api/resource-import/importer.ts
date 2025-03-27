import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';

/**
 * Removes CDKMetadata and Outputs in the template so that only resources for importing are left.
 * @returns template with import resources only
 */
export function removeNonImportResources(stack: CloudFormationStackArtifact) {
  const template = stack.template;
  delete template.Resources.CDKMetadata;
  delete template.Outputs;
  return template;
}
