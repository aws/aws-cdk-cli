import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import { GetBucketLocationCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { FakeListener } from './fake-listener';
import { MockAws, mockS3 } from './mock-aws';
import mockfs from './mock-fs';
import type { IAws } from '../lib';
import { AssetManifest, AssetPublishing } from '../lib';

let aws: IAws;
beforeEach(() => {
  mockfs({
    '/simple/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      files: {
        theAsset: {
          source: {
            path: 'some_file',
          },
          destinations: {
            theDestination1: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              bucketName: 'some_bucket',
              objectKey: 'some_key',
            },
            theDestination2: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              bucketName: 'some_bucket',
              objectKey: 'some_key2',
            },
          },
        },
      },
    }),
    '/simple/cdk.out/some_file': 'FILE_CONTENTS',
  });

  aws = new MockAws();

  mockS3.on(GetBucketLocationCommand).resolves({});
  mockS3.on(ListObjectsV2Command).resolves({ Contents: undefined });
});

afterEach(() => {
  mockfs.restore();
});

test('test listener', async () => {
  const progressListener = new FakeListener();

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), {
    aws,
    progressListener,
  });
  await pub.publish();

  const allMessages = progressListener.messages.join('\n');

  // Log mentions asset/destination ids
  expect(allMessages).toContain('theAsset:theDestination1');
  expect(allMessages).toContain('theAsset:theDestination2');
});

test('test publishing in parallel', async () => {
  const progressListener = new FakeListener();

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), {
    aws,
    progressListener,
    publishInParallel: true,
  });
  await pub.publish();

  const allMessages = progressListener.messages.join('\n');

  // Log mentions asset/destination ids
  expect(allMessages).toContain('theAsset:theDestination1');
  expect(allMessages).toContain('theAsset:theDestination2');
});

test('test abort', async () => {
  const progressListener = new FakeListener(true);

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), {
    aws,
    progressListener,
  });
  await pub.publish();

  const allMessages = progressListener.messages.join('\n');

  // We never get to asset 2
  expect(allMessages).not.toContain('theAsset:theDestination2');
});
