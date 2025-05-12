import type { StackDefinition } from '@aws-sdk/client-cloudformation';
import type { CloudFormationStack, ResourceMapping } from './cloudformation';
import { ToolkitError } from '../../toolkit/toolkit-error';

/**
 * Generates a list of stack definitions to be sent to the CloudFormation API
 * by applying each mapping to the corresponding stack template(s).
 */
export function generateStackDefinitions(mappings: ResourceMapping[], deployedStacks: CloudFormationStack[]): StackDefinition[] {
  const templates = Object.fromEntries(
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
    const sourceTemplate = templates[sourceStackName];

    const destinationStackName = mapping.destination.stack.stackName;
    const destinationLogicalId = mapping.destination.logicalResourceId;
    if (templates[destinationStackName] == null) {
      // The API doesn't allow anything in the template other than the resources
      // that are part of the mappings. So we need to create an empty template
      // to start adding resources to.
      templates[destinationStackName] = { Resources: {} };
    }
    const destinationTemplate = templates[destinationStackName];

    // Do the move
    destinationTemplate.Resources[destinationLogicalId] = sourceTemplate.Resources[sourceLogicalId];
    delete sourceTemplate.Resources[sourceLogicalId];
  });

  // CloudFormation doesn't allow empty stacks
  for (const [stackName, template] of Object.entries(templates)) {
    if (Object.keys(template.Resources ?? {}).length === 0) {
      throw new ToolkitError(`Stack ${stackName} has no resources after refactor. You must add a resource to this stack. This resource can be a simple one, like a waitCondition resource type.`);
    }
  }

  return Object.entries(templates).map(([stackName, template]) => ({
    StackName: stackName,
    TemplateBody: JSON.stringify(template),
  }));
}
