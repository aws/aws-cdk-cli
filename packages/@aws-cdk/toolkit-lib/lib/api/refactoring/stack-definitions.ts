import * as util from 'node:util';
import type { Environment } from '@aws-cdk/cx-api';
import type { StackDefinition } from '@aws-sdk/client-cloudformation';
import * as chalk from 'chalk';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { contentHash } from '../../util';
import type { SdkProvider } from '../aws-auth/sdk-provider';
import { EnvironmentResourcesRegistry } from '../environment';
import type { IoHelper } from '../io/private';
import { Mode } from '../plugin';
import type { StackTemplate } from './resource-graph';

const LARGE_TEMPLATE_SIZE_KB = 50;
const LARGE_TEMPLATE_SIZE_BYTES = LARGE_TEMPLATE_SIZE_KB * 1024;

export async function generateStackDefinitions(
  stacks: StackTemplate[],
  environment: Environment,
  sdkProvider: SdkProvider,
  ioHelper: IoHelper,
): Promise<StackDefinition[]> {
  // Check if any templates are large enough to require S3 upload
  const hasLargeTemplates = stacks.some(
    (stack) => JSON.stringify(stack.template).length > LARGE_TEMPLATE_SIZE_BYTES,
  );

  // If no large templates, use TemplateBody for all
  if (!hasLargeTemplates) {
    return stacks.map((stack) => ({
      StackName: stack.stackId,
      TemplateBody: JSON.stringify(stack.template),
    }));
  }

  const sdk = (await sdkProvider.forEnvironment(environment, Mode.ForWriting)).sdk;
  const environmentResourcesRegistry = new EnvironmentResourcesRegistry();
  const envResources = environmentResourcesRegistry.for(environment, sdk, ioHelper);
  const toolkitInfo = await envResources.lookupToolkit();

  if (!toolkitInfo.found) {
    // Find the first large template to include in the error message
    const largeStack = stacks.find(
      (stack) => JSON.stringify(stack.template).length > LARGE_TEMPLATE_SIZE_BYTES,
    )!; // Must exist since hasLargeTemplates is true

    const templateSize = Math.round(JSON.stringify(largeStack.template).length / 1024);

    await ioHelper.defaults.error(
      util.format(
        `The template for stack "${largeStack.stackId}" is ${templateSize}KiB. ` +
          `Templates larger than ${LARGE_TEMPLATE_SIZE_KB}KiB must be uploaded to S3.\n` +
          'Run the following command in order to setup an S3 bucket in this environment, and then re-refactor:\n\n',
        chalk.blue(`\t$ cdk bootstrap ${environment.name}\n`),
      ),
    );

    throw new ToolkitError('Template too large to refactor ("cdk bootstrap" is required)');
  }

  const stackDefinitions: StackDefinition[] = [];
  for (const stack of stacks) {
    const templateJson = JSON.stringify(stack.template);

    // If template is small enough, use TemplateBody
    if (templateJson.length <= LARGE_TEMPLATE_SIZE_BYTES) {
      stackDefinitions.push({
        StackName: stack.stackId,
        TemplateBody: templateJson,
      });
      continue;
    }

    // Template is too large, upload to S3
    // Generate a unique key for this template
    const templateHash = contentHash(templateJson);
    const key = `cdk-refactor/${stack.stackId}/${templateHash}.json`;

    const s3 = sdk.s3();
    await s3.upload({
      Bucket: toolkitInfo.bucketName,
      Key: key,
      Body: templateJson,
      ContentType: 'application/json',
    });

    const templateURL = `${toolkitInfo.bucketUrl}/${key}`;
    await ioHelper.defaults.debug(`Storing template for stack ${stack.stackId} in S3 at: ${templateURL}`);

    stackDefinitions.push({
      StackName: stack.stackId,
      TemplateURL: templateURL,
    });
  }

  return stackDefinitions;
}
