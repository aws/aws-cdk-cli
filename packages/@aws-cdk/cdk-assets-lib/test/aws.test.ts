import 'aws-sdk-client-mock-jest';

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
