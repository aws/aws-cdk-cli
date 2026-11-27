import 'aws-sdk-client-mock-jest';
import { promises as fs } from 'fs';
import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import { ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { mockS3 } from './mock-aws';
import mockfs from './mock-fs';
import type { IAws } from '../lib';
import { AssetManifest, AssetPublishing, DefaultAwsClient } from '../lib';

let aws: IAws;
beforeEach(() => {
  mockfs({
    '/simple/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      files: {
        theAsset: {
          source: {
            path: 'some_dir',
            packaging: 'zip',
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              bucketName: 'some_bucket',
              objectKey: 'some_key',
            },
          },
        },
      },
    }),
    '/simple/cdk.out/some_dir/some_file': 'FILE_CONTENTS',
  });

  aws = new DefaultAwsClient();

  // Accept all S3 uploads as new
  mockS3.on(ListObjectsV2Command).resolves({ Contents: undefined });
});

afterEach(() => {
  mockfs.restore();
});

test('Take a zipped upload', async () => {
  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });

  await pub.publish();

  // Upload calls PutObjectCommand under the hood
  expect(mockS3).toHaveReceivedCommandWith(PutObjectCommand, {
    Bucket: 'some_bucket',
    Key: 'some_key',
    Body: expect.anything(),
    ContentType: 'application/zip',
  });
});

describe('symlinks', () => {
  beforeEach(() => {
    mockS3.resetHistory();
  });

  function writeManifest(source: Record<string, string>) {
    mockfs.write('/symlinks/cdk.out/assets.json', JSON.stringify({
      version: Manifest.version(),
      files: {
        theAsset: {
          source,
          destinations: {
            theDestination: { region: 'us-north-50', assumeRoleArn: 'arn:aws:role', bucketName: 'some_bucket', objectKey: 'some_key' },
          },
        },
      },
    }));
    mockfs.write('/symlinks/cdk.out/some_dir/some_file', 'FILE_CONTENTS');
    mockfs.write('/symlinks/outside/other_file', 'OUTSIDE');
  }

  function publish() {
    return new AssetPublishing(AssetManifest.fromPath(mockfs.path('/symlinks/cdk.out')), { aws }).publish();
  }

  test('FOLLOW_INTERNAL_REJECT_EXTERNAL accepts symlinks inside the directory', async () => {
    writeManifest({ path: 'some_dir', packaging: 'zip', symlinks: 'FOLLOW_INTERNAL_REJECT_EXTERNAL' });
    await fs.symlink('some_file', mockfs.path('/symlinks/cdk.out/some_dir/link'));

    await publish();

    expect(mockS3).toHaveReceivedCommandWith(PutObjectCommand, { Key: 'some_key' });
  });

  test('FOLLOW_INTERNAL_REJECT_EXTERNAL rejects symlinks pointing outside the directory', async () => {
    writeManifest({ path: 'some_dir', packaging: 'zip', symlinks: 'FOLLOW_INTERNAL_REJECT_EXTERNAL' });
    await fs.symlink(mockfs.path('/symlinks/outside'), mockfs.path('/symlinks/cdk.out/some_dir/link'));

    await expect(publish()).rejects.toThrow(/points outside it/);
    expect(mockS3).not.toHaveReceivedCommand(PutObjectCommand);
  });

  test('symlinks defaults to following external symlinks', async () => {
    writeManifest({ path: 'some_dir', packaging: 'zip' });
    await fs.symlink(mockfs.path('/symlinks/outside'), mockfs.path('/symlinks/cdk.out/some_dir/link'));

    await publish();

    expect(mockS3).toHaveReceivedCommandWith(PutObjectCommand, { Key: 'some_key' });
  });

  test('symlinks is rejected for non-zip packaging', async () => {
    writeManifest({ path: 'some_dir/some_file', packaging: 'file', symlinks: 'FOLLOW_ALL' });

    await expect(publish()).rejects.toThrow(/symlinks can only be specified if packaging is set to ZIP_DIRECTORY/);
  });
});
