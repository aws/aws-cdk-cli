import { DescribeImagesCommand, DescribeRepositoriesCommand, ECRClient } from '@aws-sdk/client-ecr';
import { S3Client, UploadPartCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import type { Account, ClientOptions } from '../lib/aws';
import { DefaultAwsClient } from '../lib/aws';

export const mockEcr = mockClient(ECRClient);
export const mockS3 = mockClient(S3Client);
export const mockSecretsManager = mockClient(SecretsManagerClient);
export const mockSTS = mockClient(STSClient);

export function resetDefaultAwsMockBehavior() {
  mockEcr.on(DescribeRepositoriesCommand).resolves({
    repositories: [
      {
        repositoryName: 'repo',
        repositoryUri: '12345.amazonaws.com/repo',
      },
    ],
  });
  mockEcr.on(DescribeImagesCommand).resolves({});
  mockS3.on(UploadPartCommand).resolves({ ETag: '1' });
  mockS3.on(PutObjectCommand).resolves({});
  mockSTS
    .on(GetCallerIdentityCommand)
    .resolves({ Account: '123456789012', Arn: 'aws:swa:123456789012:some-other-stuff' });
}

export class MockAws extends DefaultAwsClient {
  discoverPartition(): Promise<string> {
    return Promise.resolve('swa');
  }

  discoverCurrentAccount(): Promise<Account> {
    return Promise.resolve({ accountId: 'current_account', partition: 'swa' });
  }

  discoverDefaultRegion(): Promise<string> {
    return Promise.resolve('current_region');
  }

  discoverTargetAccount(_options: ClientOptions): Promise<Account> {
    return Promise.resolve({ accountId: 'target_account', partition: 'swa' });
  }
}
