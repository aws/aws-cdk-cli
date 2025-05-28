import type { StackDefinition } from '@aws-sdk/client-cloudformation';
import type {
  CloudFormationResource,
  CloudFormationStack,
  CloudFormationTemplate,
  ResourceMapping,
} from './cloudformation';
import { ToolkitError } from '../../toolkit/toolkit-error';

/**
 * Generates a list of stack definitions to be sent to the CloudFormation API
 * by applying each mapping to the corresponding stack template(s).
 */
export function generateStackDefinitions(
  mappings: ResourceMapping[],
  deployedStacks: CloudFormationStack[],
  localStacks: CloudFormationStack[],
): StackDefinition[] {
  const localTemplates = Object.fromEntries(
    localStacks.map((s) => [s.stackName, JSON.parse(JSON.stringify(s.template)) as CloudFormationTemplate]),
  );
  const deployedTemplates = Object.fromEntries(
    deployedStacks.map((s) => [s.stackName, JSON.parse(JSON.stringify(s.template)) as CloudFormationTemplate]),
  );

  // First, remove from the local templates any resources that are not in the deployed templates
  iterate(localTemplates, (stackName, logicalResourceId) => {
    const location = searchLocation(stackName, logicalResourceId, 'destination', 'source');

    const deployedResource = deployedStacks.find((s) => s.stackName === location.stackName)?.template
      .Resources?.[location.logicalResourceId];

    if (deployedResource == null) {
      delete localTemplates[stackName].Resources?.[logicalResourceId];
    }
  });

  // Now do the opposite: add to the local templates any resources that are in the deployed templates
  iterate(deployedTemplates, (stackName, logicalResourceId, deployedResource) => {
    const location = searchLocation(stackName, logicalResourceId, 'source', 'destination');

    const resources = Object
      .entries(localTemplates)
      .find(([name, _]) => name === location.stackName)?.[1].Resources;
    const localResource = resources?.[location.logicalResourceId];

    if (localResource == null) {
      if (localTemplates[stackName]?.Resources) {
        localTemplates[stackName].Resources[logicalResourceId] = deployedResource;
      }
    } else {
      // This is temporary, until CloudFormation supports CDK construct path updates in the refactor API
      if (localResource.Metadata != null) {
        localResource.Metadata['aws:cdk:path'] = deployedResource.Metadata?.['aws:cdk:path'];
      }
    }
  });

  function searchLocation(stackName: string, logicalResourceId: string, from: 'source' | 'destination', to: 'source' | 'destination') {
    const mapping = mappings.find(
      (m) => m[from].stack.stackName === stackName && m[from].logicalResourceId === logicalResourceId,
    );
    return mapping != null
      ? { stackName: mapping[to].stack.stackName, logicalResourceId: mapping[to].logicalResourceId }
      : { stackName, logicalResourceId };
  }

  function iterate(
    templates: Record<string, CloudFormationTemplate>,
    cb: (stackName: string, logicalResourceId: string, resource: CloudFormationResource) => void,
  ) {
    Object.entries(templates).forEach(([stackName, template]) => {
      Object.entries(template.Resources ?? {}).forEach(([logicalResourceId, resource]) => {
        cb(stackName, logicalResourceId, resource);
      });
    });
  }

  for (const [stackName, template] of Object.entries(localTemplates)) {
    if (Object.keys(template.Resources ?? {}).length === 0) {
      throw new ToolkitError(
        `Stack ${stackName} has no resources after refactor. You must add a resource to this stack. This resource can be a simple one, like a waitCondition resource type.`,
      );
    }
  }

  return Object.entries(localTemplates)
    .filter(([stackName, _]) =>
      mappings.some((m) => {
        // Only send templates for stacks that are part of the mappings
        return m.source.stack.stackName === stackName || m.destination.stack.stackName === stackName;
      }),
    )
    .map(([stackName, template]) => ({
      StackName: stackName,
      TemplateBody: JSON.stringify(template),
    }));
}
