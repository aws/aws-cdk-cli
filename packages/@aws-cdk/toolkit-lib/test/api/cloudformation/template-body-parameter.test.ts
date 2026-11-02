import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import { makeBodyParameter, restUrlFromManifest } from '../../../lib/api/cloudformation/template-body-parameter';
import { AssetManifestBuilder } from '../../../lib/api/deployments';
import { testStack } from '../../_helpers/assembly';
import { TestIoHost } from '../../_helpers/test-io-host';

const ioHelper = new TestIoHost().asHelper('deploy');

test('restUrlFromManifest ignores AWS_ENDPOINT_URL_S3', async () => {
  process.env.AWS_ENDPOINT_URL_S3 = 'https://boop.com/';
  try {
    await expect(restUrlFromManifest('s3://my-bucket/object', {
      account: '123456789012',
      region: 'us-east-1',
      name: 'env',
    })).resolves.toEqual('https://s3.us-east-1.amazonaws.com/my-bucket/object');
  } finally {
    delete process.env.AWS_ENDPOINT_URL_S3;
  }
});

test('restUrlFromManifest respects AWS_ENDPOINT_URL_S3_FOR_CLOUDFORMATION', async () => {
  process.env.AWS_ENDPOINT_URL_S3_FOR_CLOUDFORMATION = 'https://boop.com/';
  try {
    await expect(restUrlFromManifest('s3://my-bucket/object', {
      account: '123456789012',
      region: 'us-east-1',
      name: 'env',
    })).resolves.toEqual('https://boop.com/my-bucket/object');
  } finally {
    delete process.env.AWS_ENDPOINT_URL_S3_FOR_CLOUDFORMATION;
  }
});

test('large override template asset uses stack template asset publishing role', async () => {
  const stack = testStack({
    stackName: 'LargeTemplateStack',
    template: { Resources: {} },
    assetManifest: {
      version: Manifest.version(),
      files: {
        StackTemplate: {
          source: { path: 'LargeTemplateStack.template.json' },
          destinations: {
            current: {
              bucketName: 'manifest-bucket',
              objectKey: 'original-template-object-key',
              assumeRoleArn: 'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/cdk-file-publishing-role',
              assumeRoleExternalId: 'publishing-external-id',
              assumeRoleAdditionalOptions: {
                TransitiveTagKeys: ['aws-cdk:test'],
              },
              region: '${AWS::Region}',
            },
          },
        },
      },
    },
  });
  const assetManifest = new AssetManifestBuilder();
  const resources = {
    lookupToolkit: jest.fn().mockResolvedValue({
      found: true,
      bucketName: 'bootstrap-bucket',
      bucketUrl: 'https://bootstrap-bucket.s3.amazonaws.com',
    }),
  };

  const result = await makeBodyParameter(
    ioHelper,
    stack,
    { account: '123456789012', region: 'us-east-1', name: 'aws://123456789012/us-east-1' },
    assetManifest,
    resources as any,
    { Resources: { LargeResource: { Type: 'AWS::S3::Bucket', Metadata: { Padding: 'x'.repeat(60 * 1024) } } } },
  );

  expect(result.TemplateURL).toMatch(/^https:\/\/bootstrap-bucket\.s3\.amazonaws\.com\/cdk\/LargeTemplateStack\/.*\.yml$/);

  const [templateAsset] = assetManifest.toManifest(stack.assembly.directory).entries;
  expect((templateAsset as any).destination).toEqual({
    bucketName: 'bootstrap-bucket',
    objectKey: expect.stringMatching(/^cdk\/LargeTemplateStack\/.*\.yml$/),
    assumeRoleArn: 'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/cdk-file-publishing-role',
    assumeRoleExternalId: 'publishing-external-id',
    assumeRoleAdditionalOptions: {
      TransitiveTagKeys: ['aws-cdk:test'],
    },
    region: '${AWS::Region}',
  });
});
