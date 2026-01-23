import * as util from 'node:util';
import type { Environment } from '@aws-cdk/cx-api';
import type { StackDefinition } from '@aws-sdk/client-cloudformation';
import * as chalk from 'chalk';
import type { CloudFormationStack, ResourceMapping } from './cloudformation';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { contentHash } from '../../util';
import type { SdkProvider } from '../aws-auth/sdk-provider';
import { EnvironmentResourcesRegistry } from '../environment';
import type { IoHelper } from '../io/private';
import { Mode } from '../plugin';
// namespace object imports won't work in the bundle for function exports
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepEqual = require('fast-deep-equal');

const LARGE_TEMPLATE_SIZE_KB = 50;
const LARGE_TEMPLATE_SIZE_BYTES = LARGE_TEMPLATE_SIZE_KB * 1024;

export async function generateStackDefinitions(
  mappings: ResourceMapping[],
  deployedStacks: CloudFormationStack[],
  localStacks: CloudFormationStack[],
  environment: Environment,
  sdkProvider: SdkProvider,
  ioHelper: IoHelper,
): Promise<StackDefinition[]> {
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

  // Check if any templates are large enough to require S3 upload
  const hasLargeTemplates = stacksToProcess.some(
    stack => JSON.stringify(stack.template).length > LARGE_TEMPLATE_SIZE_BYTES,
  );

  // If no large templates, use TemplateBody for all
  if (!hasLargeTemplates) {
    return stacksToProcess.map(stack => ({
      StackName: stack.stackName,
      TemplateBody: JSON.stringify(stack.template),
    }));
  }

  const sdk = (await sdkProvider.forEnvironment(environment, Mode.ForWriting)).sdk;
  const environmentResourcesRegistry = new EnvironmentResourcesRegistry();
  const envResources = environmentResourcesRegistry.for(environment, sdk, ioHelper);
  const toolkitInfo = await envResources.lookupToolkit();

  if (!toolkitInfo.found) {
    // Find the first large template to include in the error message
    const largeStack = stacksToProcess.find(
      stack => JSON.stringify(stack.template).length > LARGE_TEMPLATE_SIZE_BYTES,
    )!; // Must exist since hasLargeTemplates is true

    const templateSize = Math.round(JSON.stringify(largeStack.template).length / 1024);

    await ioHelper.defaults.error(
      util.format(
        `The template for stack "${largeStack.stackName}" is ${templateSize}KiB. ` +
        `Templates larger than ${LARGE_TEMPLATE_SIZE_KB}KiB must be uploaded to S3.\n` +
        'Run the following command in order to setup an S3 bucket in this environment, and then re-refactor:\n\n',
        chalk.blue(`\t$ cdk bootstrap ${environment.name}\n`),
      ),
    );

    throw new ToolkitError('Template too large to refactor ("cdk bootstrap" is required)');
  }

  const stackDefinitions: StackDefinition[] = [];
  for (const stack of stacksToProcess) {
    const templateJson = JSON.stringify(stack.template);

    // If template is small enough, use TemplateBody
    if (templateJson.length <= LARGE_TEMPLATE_SIZE_BYTES) {
      stackDefinitions.push({
        StackName: stack.stackName,
        TemplateBody: templateJson,
      });
      continue;
    }

    // Template is too large, upload to S3
    // Generate a unique key for this template
    const templateHash = contentHash(templateJson);
    const key = `cdk-refactor/${stack.stackName}/${templateHash}.json`;

    const s3 = sdk.s3();
    await s3.upload({
      Bucket: toolkitInfo.bucketName,
      Key: key,
      Body: templateJson,
      ContentType: 'application/json',
    });

    const templateURL = `${toolkitInfo.bucketUrl}/${key}`;
    await ioHelper.defaults.debug(`Storing template for stack ${stack.stackName} in S3 at: ${templateURL}`);

    stackDefinitions.push({
      StackName: stack.stackName,
      TemplateURL: templateURL,
    });
  }

  return stackDefinitions;
}
