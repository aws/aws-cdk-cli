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
  }

  const stacksToProcess = localStacks.filter((localStack) => {
    const deployedStack = deployedStackMap.get(localStack.stackName);
    return !deployedStack || !deepEqual(localStack.template, deployedStack.template);
  });

  // Now, for every stack name that appears in the mappings, but is not present in the local stacks,
  // we need to take its (deployed) template and remove all the resources that appear in the sources
  // part of the mappings. For example, if the mappings contains an entry like:
  //  - StackB.Foo -> StackA.Bar
  // and StackB does not exist locally, we need to take StackB's template, and remove the resource Foo,
  // and include this modified template for StackB in the stack definitions.
  for (let mapping of mappings) {
    const stackName = mapping.source.stackName;
    if (!localStacks.some(s => s.stackName === stackName)) {
      const deployedStack = deployedStackMap.get(stackName);
      delete deployedStack?.template.Resources?.[mapping.source.logicalResourceId];

      delete deployedStack?.template.Outputs;

      if (deployedStack && !stacksToProcess.some(s => s.stackName === stackName)) {
        stacksToProcess.push(deployedStack);
      }
    }
  }

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
