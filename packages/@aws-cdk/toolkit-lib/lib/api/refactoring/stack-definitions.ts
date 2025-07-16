import type { StackDefinition } from '@aws-sdk/client-cloudformation';
import type { CloudFormationStack, ResourceMapping } from './cloudformation';
// namespace object imports won't work in the bundle for function exports
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepEqual = require('fast-deep-equal');

export function generateStackDefinitions(
  mappings: ResourceMapping[],
  deployedStacks: CloudFormationStack[],
  localStacks: CloudFormationStack[],
): StackDefinition[] {
  const deployedStackMap: Map<string, CloudFormationStack> = new Map(deployedStacks.map((s) => [s.stackName, s]));

  // For every local stack that is also deployed, update the local template,
  // overwriting its CDKMetadata resource with the one from the deployed stack
  for (const localStack of localStacks) {
    const deployedStack = deployedStackMap.get(localStack.stackName);
    const localTemplate = localStack.template;
    const deployedTemplate = deployedStack?.template;

    // The CDKMetadata resource is never part of a refactor. So at this point we need
    // to adjust the template we will send to the API to make sure it has the same CDKMetadata
    // as the deployed template. And if the deployed template doesn't have any, we cannot
    // send any either.
    if (deployedTemplate?.Resources?.CDKMetadata != null) {
      localTemplate.Resources = localTemplate.Resources ?? {};
      localTemplate.Resources.CDKMetadata = deployedTemplate.Resources.CDKMetadata;
    } else {
      delete localTemplate.Resources?.CDKMetadata;
    }

    // For every resource in the local template, take the Metadata['aws:cdk:path'] from the corresponding resource in the deployed template.
    // A corresponding resource is one that the local maps to (using the `mappings` parameter). If there is no entry mapping the local
    // resource, use the same id
    // TODO Remove this logic once CloudFormation starts allowing changes to the construct path.
    //  But we need it for now, otherwise we won't be able to refactor anything.
    for (const [logicalId, localResource] of Object.entries(localTemplate.Resources ?? {})) {
      const mapping = mappings.find(
        (m) => m.destination.stackName === localStack.stackName && m.destination.logicalResourceId === logicalId,
      );

      if (mapping != null) {
        const deployed = deployedStackMap.get(mapping.source.stackName)!;
        const deployedResource = deployed.template?.Resources?.[mapping.source.logicalResourceId]!;
        if (deployedResource.Metadata != null || localResource.Metadata != null) {
          localResource.Metadata = localResource.Metadata ?? {};
          localResource.Metadata['aws:cdk:path'] = deployedResource?.Metadata?.['aws:cdk:path'];
        }
      }
    }
  }

  const stacksToProcess = localStacks.filter((localStack) => {
    const deployedStack = deployedStackMap.get(localStack.stackName);
    return !deployedStack || !deepEqual(localStack.template, deployedStack.template);
  });

  // For stacks created by the refactor, CloudFormation does not allow Rules or Parameters
  for (const stack of stacksToProcess) {
    if (!deployedStacks.some(deployed => deployed.stackName === stack.stackName)) {
      if ('Rules' in stack.template) {
        delete stack.template.Rules;
      }
      if ('Parameters' in stack.template) {
        delete stack.template.Parameters;
      }
    }
  }

  return stacksToProcess.map((stack) => ({
    StackName: stack.stackName,
    TemplateBody: JSON.stringify(stack.template),
  }));
}
