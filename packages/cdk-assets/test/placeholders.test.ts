import 'aws-sdk-client-mock-jest';

import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import { DescribeImagesCommand } from '@aws-sdk/client-ecr';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { MockAws, mockEcr, mockS3, resetDefaultAwsMockBehavior } from './mock-aws';
import mockfs from './mock-fs';
import type { IAws } from '../lib';
import { AssetManifest, AssetPublishing } from '../lib';

let aws: IAws;
beforeEach(() => {
  resetDefaultAwsMockBehavior();
  mockfs({
    '/simple/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      files: {
        fileAsset: {
          type: 'file',
          source: {
            path: 'some_file',
          },
          destinations: {
            theDestination: {
              // Absence of region
              assumeRoleArn: 'arn:aws:role-${AWS::AccountId}',
              bucketName: 'some_bucket-${AWS::AccountId}-${AWS::Region}',
              objectKey: 'some_key-${AWS::AccountId}-${AWS::Region}',
            },
          },
        },
      },
      dockerImages: {
        dockerAsset: {
          type: 'docker-image',
          source: {
            directory: 'dockerdir',
          },
          destinations: {
            theDestination: {
              // Explicit region
              region: 'explicit_region',
              assumeRoleArn: 'arn:aws:role-${AWS::AccountId}',
              repositoryName: 'repo-${AWS::AccountId}-${AWS::Region}',
              imageTag: 'abcdef',
            },
          },
        },
      },
    }),
    '/simple/cdk.out/some_file': 'FILE_CONTENTS',
  });
});

afterEach(() => {
  mockfs.restore();
});

test('correct calls are made', async () => {
  aws = new MockAws();
  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });
  mockS3.on(ListObjectsV2Command).resolves({
    Contents: [{ Key: 'some_key-current_account-current_region' }],
  });
  mockEcr.on(DescribeImagesCommand).resolves({});

  const s3Client = jest.spyOn(aws, 's3Client');
  const ecrClient = jest.spyOn(aws, 'ecrClient');

  await pub.publish();

  expect(s3Client).toHaveBeenCalledWith({
    assumeRoleArn: 'arn:aws:role-current_account',
  });

  expect(mockS3).toHaveReceivedCommandWith(ListObjectsV2Command, {
    Bucket: 'some_bucket-current_account-current_region',
    Prefix: 'some_key-current_account-current_region',
    MaxKeys: 1,
  });

  expect(ecrClient).toHaveBeenCalledWith({
    assumeRoleArn: 'arn:aws:role-current_account',
    quiet: undefined,
    region: 'explicit_region',
  });

  expect(mockEcr).toHaveReceivedCommandWith(DescribeImagesCommand, {
    imageIds: [{ imageTag: 'abcdef' }],
    repositoryName: 'repo-current_account-explicit_region',
  });
});
