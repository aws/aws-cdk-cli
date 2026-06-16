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

describe('S3 path-style addressing', () => {
  const ENV_VARS = ['CDK_S3_FORCE_PATH_STYLE', 'AWS_ENDPOINT_URL_S3', 'AWS_ENDPOINT_URL'];
  const original: Record<string, string | undefined> = {};
  let s3ClientSpy: jest.SpyInstance;

  beforeEach(() => {
    for (const v of ENV_VARS) {
      original[v] = process.env[v];
      delete process.env[v];
    }
    s3ClientSpy = jest.spyOn(s3, 'S3Client').mockImplementation(() => ({}) as any);
  });

  afterEach(() => {
    s3ClientSpy.mockRestore();
    for (const v of ENV_VARS) {
      if (original[v] === undefined) {
        delete process.env[v];
      } else {
        process.env[v] = original[v];
      }
    }
  });

  test('forces path-style addressing on the S3 client when CDK_S3_FORCE_PATH_STYLE is set', async () => {
    process.env.CDK_S3_FORCE_PATH_STYLE = '1';

    await new DefaultAwsClient().s3Client({ region: 'far-far-away' });

    expect(s3ClientSpy).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: true }));
  });

  test('auto-detects path-style addressing for a loopback endpoint', async () => {
    process.env.AWS_ENDPOINT_URL_S3 = 'http://localhost:4566';

    await new DefaultAwsClient().s3Client({ region: 'far-far-away' });

    expect(s3ClientSpy).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: true }));
  });

  test('leaves path-style addressing unset on the S3 client by default', async () => {
    await new DefaultAwsClient().s3Client({ region: 'far-far-away' });

    expect(s3ClientSpy).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: undefined }));
  });
});
