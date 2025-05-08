import type { StackDefinition } from '@aws-sdk/client-cloudformation';
import type { CloudFormationStack, ResourceMapping } from './cloudformation';

/**
 * Generates a list of stack definitions to be sent to the CloudFormation API
 * by applying each mapping to the corresponding stack template(s).
 */
export function generateStackDefinitions(mappings: ResourceMapping[], deployedStacks: CloudFormationStack[]): StackDefinition[] {
  const deployedTemplates = Object.fromEntries(
    deployedStacks
      .filter((s) =>
        mappings.some(
          (m) =>
            // We only care about stacks that are part of the mappings
            m.source.stack.stackName === s.stackName || m.destination.stack.stackName === s.stackName,
        ),
      )
      .map((s) => [s.stackName, JSON.parse(JSON.stringify(s.template))]),
  );

  mappings.forEach((mapping) => {
    const sourceStackName = mapping.source.stack.stackName;
    const sourceLogicalId = mapping.source.logicalResourceId;
    const sourceTemplate = deployedTemplates[sourceStackName];

    const destinationStackName = mapping.destination.stack.stackName;
    const destinationLogicalId = mapping.destination.logicalResourceId;
    if (deployedTemplates[destinationStackName] == null) {
      // The API doesn't allow anything in the template other than the resources
      // that are part of the mappings. So we need to create an empty template
      // to start adding resources to.
      deployedTemplates[destinationStackName] = { Resources: {} };
    }
    const destinationTemplate = deployedTemplates[destinationStackName];

    // Do the move
    destinationTemplate.Resources[destinationLogicalId] = sourceTemplate.Resources[sourceLogicalId];
    delete sourceTemplate.Resources[sourceLogicalId];
  });

  return Object.entries(deployedTemplates).map(([stackName, template]) => ({
    StackName: stackName,
    TemplateBody: JSON.stringify(template),
  }));
}
