import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as util from 'node:util';
import { type CloudFormationStackArtifact, type Environment, EnvironmentPlaceholders } from '@aws-cdk/cloud-assembly-api';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getEndpointFromInstructions } from '@smithy/middleware-endpoint';
import * as chalk from 'chalk';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { contentHash, toYAML } from '../../util';
import type { AssetManifestBuilder } from '../deployments';
import type { EnvironmentResources } from '../environment';
import type { IoHelper } from '../io/private';

export type TemplateBodyParameter = {
  TemplateBody?: string;
  TemplateURL?: string;
};

const LARGE_TEMPLATE_SIZE_KB = 50;

/**
 * Prepares the body parameter for +CreateChangeSet+.
 *
 * If the template is small enough to be inlined into the API call, just return
 * it immediately.
 *
 * Otherwise, add it to the asset manifest to get uploaded to the staging
 * bucket and return its coordinates. If there is no staging bucket, an error
 * is thrown.
 *
 * @param stack     - the synthesized stack that provides the CloudFormation template
 * @param toolkitInfo - information about the toolkit stack
 */
export async function makeBodyParameter(
  ioHelper: IoHelper,
  stack: CloudFormationStackArtifact,
  resolvedEnvironment: Environment,
  assetManifest: AssetManifestBuilder,
  resources: EnvironmentResources,
  overrideTemplate?: any,
): Promise<TemplateBodyParameter> {
  // If the template has already been uploaded to S3, just use it from there.
  if (stack.stackTemplateAssetObjectUrl && !overrideTemplate) {
    return {
      TemplateURL: await restUrlFromManifest(stack.stackTemplateAssetObjectUrl, resolvedEnvironment),
    };
  }

  // Otherwise, pass via API call (if small) or upload here (if large)
  const templateJson = toYAML(overrideTemplate ?? stack.template);

  if (templateJson.length <= LARGE_TEMPLATE_SIZE_KB * 1024) {
    return { TemplateBody: templateJson };
  }

  const toolkitInfo = await resources.lookupToolkit();
  if (!toolkitInfo.found) {
    await ioHelper.defaults.error(
      util.format(
        `The template for stack "${stack.displayName}" is ${Math.round(templateJson.length / 1024)}KiB. ` +
        `Templates larger than ${LARGE_TEMPLATE_SIZE_KB}KiB must be uploaded to S3.\n` +
        'Run the following command in order to setup an S3 bucket in this environment, and then re-deploy:\n\n',
        chalk.blue(`\t$ cdk bootstrap ${resolvedEnvironment.name}\n`),
      ),
    );

    throw new ToolkitError('Template too large to deploy ("cdk bootstrap" is required)');
  }

  const templateHash = contentHash(templateJson);
  const key = `cdk/${stack.id}/${templateHash}.yml`;

  let templateFile = stack.templateFile;
  if (overrideTemplate) {
    // Add a variant of this template
    templateFile = `${stack.templateFile}-${templateHash}.yaml`;
    const templateFilePath = path.join(stack.assembly.directory, templateFile);
    await fs.writeFile(templateFilePath, templateJson, { encoding: 'utf-8' });
  }

  assetManifest.addFileAsset(
    templateHash,
    {
      path: templateFile,
    },
    {
      bucketName: toolkitInfo.bucketName,
      objectKey: key,
    },
  );

  const templateURL = `${toolkitInfo.bucketUrl}/${key}`;
  await ioHelper.defaults.debug(`Storing template in S3 at: ${templateURL}`);
  return { TemplateURL: templateURL };
}

/**
 * Format an S3 URL in the manifest for use with CloudFormation
 *
 * Replaces environment placeholders (which this field may contain),
 * and reformats s3://.../... urls into S3 REST URLs (which CloudFormation
 * expects).
 *
 * We need to return the official region- and partition-specific URL for AWS S3
 * here, so we use the SDK's information about endpoints. At the same time, the
 * SDK allows overriding this URL by setting an environment variable
 * (specifically $AWS_ENDPOINT_URL_S3) but we want to *not* honor that, because
 * there's a 99.9% chance this URL will not be routable from AWS CloudFormation.
 *
 * To allow for the off chance that someone is running this tool against a
 * custom build of CloudFormation that does need a specific S3 endpoint passed
 * to it, we'll introduce a new environment variable that we'll respect instead:
 *
 *  AWS_ENDPOINT_URL_S3_FOR_CLOUDFORMATION
 */
export async function restUrlFromManifest(url: string, environment: Environment): Promise<string> {
  const doNotUseMarker = '**DONOTUSE**';
  const region = environment.region;
  // This URL may contain placeholders, so still substitute those.
  url = EnvironmentPlaceholders.replace(url, {
    accountId: environment.account,
    region,
    partition: doNotUseMarker,
  });

  // Yes, this is extremely crude, but we don't actually need this so I'm not inclined to spend
  // a lot of effort trying to thread the right value to this location.
  if (url.indexOf(doNotUseMarker) > -1) {
    throw new ToolkitError("Cannot use '${AWS::Partition}' in the 'stackTemplateAssetObjectUrl' field");
  }

  const s3Url = url.match(/s3:\/\/([^/]+)\/(.*)$/);
  if (!s3Url) {
    return url;
  }

  // We need to pass an 'https://s3.REGION.amazonaws.com[.cn]/bucket/object' URL to CloudFormation, but we
  // got an 's3://bucket/object' URL instead. Construct the rest API URL here.
  const bucketName = s3Url[1];
  const objectKey = s3Url[2];

  const originalOverrideS3Endpoint = process.env.AWS_ENDPOINT_URL_S3;
  setEnv('AWS_ENDPOINT_URL_S3', process.env.AWS_ENDPOINT_URL_S3_FOR_CLOUDFORMATION);
  try {
    // SDK v3 no longer allows for getting endpoints from only region.
    // A command and client config must now be provided.
    const s3 = new S3Client({ region });
    const endpoint = await getEndpointFromInstructions({}, HeadObjectCommand, {
      ...s3.config,
    });

    return `${endpoint.url.origin}/${bucketName}/${objectKey}`;
  } finally {
    setEnv('AWS_ENDPOINT_URL_S3', originalOverrideS3Endpoint);
  }
}

function setEnv(name: string, value: string | undefined) {
  if (value) {
    process.env[name] = value;
  } else {
    delete process.env[name];
  }
}
