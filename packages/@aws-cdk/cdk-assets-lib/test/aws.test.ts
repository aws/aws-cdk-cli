import 'aws-sdk-client-mock-jest';

import * as s3 from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { mockSTS } from './mock-aws';
import { DefaultAwsClient } from '../lib';

jest.mock('@aws-sdk/credential-providers');

const roleArn = 'arn:aws:iam:123456789012:role/the-role-of-a-lifetime';

mockSTS.on(GetCallerIdentityCommand).resolves({
  Account: '123456789012',
  Arn: roleArn,
});

test('the correct credentials are passed to fromTemporaryCredentials in awsOptions', async () => {
  const aws = new DefaultAwsClient();

  await aws.discoverTargetAccount({
    region: 'far-far-away',
    assumeRoleArn: roleArn,
    assumeRoleExternalId: 'external-id',
    assumeRoleAdditionalOptions: {
      DurationSeconds: 3600,
      RoleSessionName: 'definitely-me',
    },
  });

  expect(fromTemporaryCredentials).toHaveBeenCalledWith({
    clientConfig: {
      customUserAgent: 'cdk-assets',
    },
    params: {
      ExternalId: 'external-id',
      RoleArn: roleArn,
      RoleSessionName: 'definitely-me',
      DurationSeconds: 3600,
    },
  });
});

test('session tags are passed to fromTemporaryCredentials in awsOptions', async () => {
  const aws = new DefaultAwsClient();

  await aws.discoverTargetAccount({
    region: 'far-far-away',
    assumeRoleArn: roleArn,
    assumeRoleExternalId: 'external-id',
    assumeRoleAdditionalOptions: {
      RoleSessionName: 'definitely-me',
      Tags: [
        { Key: 'this', Value: 'one' },
        { Key: 'that', Value: 'one' },
      ],
    },
  });

  expect(fromTemporaryCredentials).toHaveBeenCalledWith({
    clientConfig: {
      customUserAgent: 'cdk-assets',
    },
    params: {
      ExternalId: 'external-id',
      RoleArn: roleArn,
      RoleSessionName: 'definitely-me',
      Tags: [
        { Key: 'this', Value: 'one' },
        { Key: 'that', Value: 'one' },
      ],
      TransitiveTagKeys: ['this', 'that'],
    },
  });
});

describe('CDK_S3_FORCE_PATH_STYLE', () => {
  let s3ClientSpy: jest.SpyInstance;
  const originalValue = process.env.CDK_S3_FORCE_PATH_STYLE;

  beforeEach(() => {
    s3ClientSpy = jest.spyOn(s3, 'S3Client').mockImplementation(() => ({}) as any);
  });

  afterEach(() => {
    s3ClientSpy.mockRestore();
    if (originalValue === undefined) {
      delete process.env.CDK_S3_FORCE_PATH_STYLE;
    } else {
      process.env.CDK_S3_FORCE_PATH_STYLE = originalValue;
    }
  });

  test('forces path-style addressing on the S3 client when set', async () => {
    process.env.CDK_S3_FORCE_PATH_STYLE = '1';
    const aws = new DefaultAwsClient();

    await aws.s3Client({ region: 'far-far-away' });

    expect(s3ClientSpy).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: true }));
  });

  test('leaves path-style addressing unset on the S3 client when not set', async () => {
    delete process.env.CDK_S3_FORCE_PATH_STYLE;
    const aws = new DefaultAwsClient();

    await aws.s3Client({ region: 'far-far-away' });

    expect(s3ClientSpy).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: undefined }));
  });
});
