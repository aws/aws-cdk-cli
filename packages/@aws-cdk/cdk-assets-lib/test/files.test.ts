jest.mock('child_process');

import 'aws-sdk-client-mock-jest';
import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import {
  GetBucketEncryptionCommand,
  GetBucketLocationCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { FakeListener } from './fake-listener';
import { MockAws, mockS3 } from './mock-aws';
import { mockSpawn } from './mock-child_process';
import mockfs from './mock-fs';
import { AssetPublishing, AssetManifest, DefaultAwsClient } from '../lib';

const ABS_PATH = '/simple/cdk.out/some_external_file';

const DEFAULT_DESTINATION = {
  region: 'us-north-50',
  assumeRoleArn: 'arn:aws:role',
  bucketName: 'some_bucket',
  objectKey: 'some_key',
};

let aws: MockAws;
beforeEach(() => {
  jest.resetAllMocks();
  mockS3.resetHistory();

  mockfs({
    '/simple/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      files: {
        theAsset: {
          source: {
            path: 'some_file',
          },
          destinations: { theDestination: DEFAULT_DESTINATION },
        },
      },
    }),
    '/simple/cdk.out/some_file': 'FILE_CONTENTS',
    [ABS_PATH]: 'ZIP_FILE_THAT_IS_DEFINITELY_NOT_EMPTY',
    '/abs/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      files: {
        theAsset: {
          source: {
            path: `${mockfs.path('/simple/cdk.out/some_file')}`,
          },
          destinations: {
            theDestination: { ...DEFAULT_DESTINATION, bucketName: 'some_other_bucket' },
          },
        },
      },
    }),
    '/external/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      files: {
        externalAsset: {
          source: {
            executable: ['sometool'],
          },
          destinations: {
            theDestination: { ...DEFAULT_DESTINATION, bucketName: 'some_external_bucket' },
          },
        },
      },
    }),
    '/types/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      files: {
        theTextAsset: {
          source: {
            path: 'plain_text.txt',
          },
          destinations: { theDestination: { ...DEFAULT_DESTINATION, objectKey: 'some_key.txt' } },
        },
        theImageAsset: {
          source: {
            path: 'image.png',
          },
          destinations: { theDestination: { ...DEFAULT_DESTINATION, objectKey: 'some_key.png' } },
        },
      },
    }),
    '/types/cdk.out/plain_text.txt': 'FILE_CONTENTS',
    '/types/cdk.out/image.png': 'FILE_CONTENTS',
    '/emptyzip/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      files: {
        theTextAsset: {
          source: {
            path: 'empty_dir',
            packaging: 'zip',
          },
          destinations: { theDestination: DEFAULT_DESTINATION },
        },
      },
    }),
    '/emptyzip/cdk.out/empty_dir': {}, // Empty directory
  });

  aws = new MockAws();
});

afterEach(() => {
  mockfs.restore();
});

test('will only read bucketEncryption once even for multiple assets', async () => {
  const s3 = mockClient(S3Client);
  s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'some_key.but_not_the_one' }] });

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/types/cdk.out')), { aws });
  await pub.publish();

  // Upload calls PutObjectCommand under the hood
  expect(s3).toHaveReceivedCommandTimes(PutObjectCommand, 2);
  expect(s3).toHaveReceivedCommandTimes(GetBucketEncryptionCommand, 1);
});

test.each([false, true])('file already exists with { force: %p }', async (force) => {
  const s3 = mockClient(S3Client);

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });
  s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'some_key' }] });

  await pub.publish({ force });

  // Upload calls PutObjectCommand under the hood
  if (force) {
    expect(s3).toHaveReceivedCommand(PutObjectCommand);
  } else {
    expect(s3).toHaveReceivedCommandWith(ListObjectsV2Command, {
      Bucket: 'some_bucket',
      Prefix: 'some_key',
      MaxKeys: 1,
    });

    expect(s3).not.toHaveReceivedCommand(PutObjectCommand);
  }
});

test('tiny file does not count as cache hit', async () => {
  const s3 = mockClient(S3Client);

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });
  s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'some_key', Size: 5 }] });

  await pub.publish();

  expect(s3).toHaveReceivedCommandTimes(PutObjectCommand, 1);
});

test('upload file if new (list returns other key)', async () => {
  const s3 = mockClient(S3Client);
  s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'some_key.but_not_the_one' }] });

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });
  await pub.publish();

  expect(s3).toHaveReceivedCommandTimes(PutObjectCommand, 1);
});

test('upload with server side encryption AES256 header', async () => {
  const s3 = mockClient(S3Client);
  s3.on(GetBucketEncryptionCommand).resolves({
    ServerSideEncryptionConfiguration: {
      Rules: [
        {
          ApplyServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256',
          },
          BucketKeyEnabled: false,
        },
      ],
    },
  });
  s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'some_key.but_not_the_one' }] });

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });
  await pub.publish();

  expect(s3).toHaveReceivedCommandWith(PutObjectCommand, {
    ContentType: 'application/octet-stream',
    Bucket: 'some_bucket',
    Key: 'some_key',
    ServerSideEncryption: 'AES256',
    Body: Buffer.from('FILE_CONTENTS'),
  });
});

test('will use SHA256 content checksum', async () => {
  const s3 = mockClient(S3Client);
  s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'some_key.but_not_the_one' }] });

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/types/cdk.out')), { aws });
  await pub.publish();

  expect(s3).toHaveReceivedCommandWith(PutObjectCommand, {
    ChecksumAlgorithm: 'SHA256',
  });
});

test('upload with server side encryption aws:kms header and key id', async () => {
  const s3 = mockClient(S3Client);
  s3.on(GetBucketEncryptionCommand).resolves({
    ServerSideEncryptionConfiguration: {
      Rules: [
        {
          ApplyServerSideEncryptionByDefault: {
            SSEAlgorithm: 'aws:kms',
            KMSMasterKeyID: 'the-key-id',
          },
          BucketKeyEnabled: false,
        },
      ],
    },
  });
  s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'some_key.but_not_the_one' }] });

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });
  await pub.publish();

  expect(s3).toHaveReceivedCommandWith(PutObjectCommand, {
    Bucket: 'some_bucket',
    Key: 'some_key',
    ContentType: 'application/octet-stream',
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: 'the-key-id',
    Body: Buffer.from('FILE_CONTENTS'),
  });
});

test('no server side encryption header if access denied for bucket encryption', async () => {
  const s3 = mockClient(S3Client);
  const err = new Error('Access Denied');
  err.name = 'AccessDenied';
  s3.on(GetBucketEncryptionCommand).rejects(err);
  s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'some_key.but_not_the_one' }] });

  const progressListener = new FakeListener();
  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), {
    aws,
    progressListener,
  });

  await pub.publish();

  expect(s3).not.toHaveReceivedCommandWith(PutObjectCommand, {
    Bucket: 'some_bucket',
    Key: 'some_key',
    ContentType: 'application/octet-stream',
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: 'the-key-id',
    Body: Buffer.from('FILE_CONTENTS'),
  });

  expect(s3).not.toHaveReceivedCommandWith(PutObjectCommand, {
    Bucket: 'some_bucket',
    Key: 'some_key',
    ContentType: 'application/octet-stream',
    ServerSideEncryption: 'AWS256',
    SSEKMSKeyId: 'the-key-id',
    Body: Buffer.from('FILE_CONTENTS'),
  });

  expect(s3).toHaveReceivedCommandWith(PutObjectCommand, {
    Bucket: 'some_bucket',
    Key: 'some_key',
    ContentType: 'application/octet-stream',
    Body: Buffer.from('FILE_CONTENTS'),
  });
});

test('correctly looks up content type', async () => {
  const s3 = mockClient(S3Client);
  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/types/cdk.out')), { aws });
  s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'some_key.but_not_the_one' }] });

  await pub.publish();

  expect(s3).toHaveReceivedCommandWith(PutObjectCommand, {
    Bucket: 'some_bucket',
    Key: 'some_key.txt',
    ContentType: 'text/plain',
    Body: Buffer.from('FILE_CONTENTS'),
  });

  expect(s3).toHaveReceivedCommandWith(PutObjectCommand, {
    Bucket: 'some_bucket',
    Key: 'some_key.png',
    ContentType: 'image/png',
    Body: Buffer.from('FILE_CONTENTS'),
  });
});

test('upload file if new (list returns no key)', async () => {
  const s3 = mockClient(S3Client);
  s3.on(ListObjectsV2Command).resolves({ Contents: undefined });

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });
  await pub.publish();

  expect(s3).toHaveReceivedCommandWith(PutObjectCommand, {
    Bucket: 'some_bucket',
    Key: 'some_key',
    Body: Buffer.from('FILE_CONTENTS'),
  });
});

test('successful run does not need to query account ID', async () => {
  const s3 = mockClient(S3Client);
  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });
  s3.on(ListObjectsV2Command).resolves({ Contents: undefined });
  const discoverCurrentAccount = jest.spyOn(aws, 'discoverCurrentAccount');
  const discoverTargetAccount = jest.spyOn(aws, 'discoverTargetAccount');

  await pub.publish();

  expect(discoverCurrentAccount).not.toHaveBeenCalled();
  expect(discoverTargetAccount).not.toHaveBeenCalled();
});

test('correctly identify asset path if path is absolute', async () => {
  const s3 = mockClient(S3Client);

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/abs/cdk.out')), { aws });
  s3.on(ListObjectsV2Command).resolves({ Contents: undefined });

  await pub.publish();

  // THEN: doesn't throw
});

describe('external assets', () => {
  let pub: AssetPublishing;
  beforeEach(() => {
    pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/external/cdk.out')), { aws });
  });

  test('do nothing if file exists already', async () => {
    const s3 = mockClient(S3Client);

    s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'some_key' }] });

    await pub.publish();

    expect(s3).toReceiveCommandWith(ListObjectsV2Command, {
      Bucket: 'some_external_bucket',
      Prefix: 'some_key',
      MaxKeys: 1,
    });
  });

  test('upload external asset correctly', async () => {
    const s3 = mockClient(S3Client);

    s3.on(ListObjectsV2Command).resolves({ Contents: undefined });

    const expectAllSpawns = mockSpawn({
      commandLine: ['sometool'],
      stdout: `${mockfs.path(ABS_PATH)}`,
    });

    await pub.publish();

    expect(s3).toHaveReceivedCommandTimes(PutObjectCommand, 1);

    expectAllSpawns();
  });
});

test('pass destination properties into AWS client', async () => {
  aws = new DefaultAwsClient();
  const s3Client = jest.spyOn(aws, 's3Client');
  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), {
    aws,
    throwOnError: false,
  });
  await pub.publish();

  expect(s3Client).toHaveBeenCalledWith(
    expect.objectContaining({
      region: 'us-north-50',
      assumeRoleArn: 'arn:aws:role',
    }),
  );
});

test('fails when we dont have access to the bucket', async () => {
  const s3 = mockClient(S3Client);
  const err = new Error('Access Denied');
  err.name = 'AccessDenied';
  s3.on(GetBucketLocationCommand).rejects(err);

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });

  await expect(pub.publish()).rejects.toThrow('but we dont have access to it');
});

test('fails when cross account is required but not allowed', async () => {
  const s3 = mockClient(S3Client);

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });

  s3.on(GetBucketLocationCommand).callsFake((req) => {
    if (req.ExpectedBucketOwner) {
      const err = new Error('Access Denied');
      err.name = 'AccessDenied';
      throw err;
    }
    return {};
  });

  await expect(pub.publish({ allowCrossAccount: false })).rejects.toThrow(
    '❗❗ UNEXPECTED BUCKET OWNER DETECTED ❗❗',
  );
});

test('succeeds when bucket doesnt belong to us but doesnt contain account id - cross account', async () => {
  const s3 = mockClient(S3Client);

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });

  s3.on(ListObjectsV2Command).resolves({ Contents: undefined });
  s3.on(GetBucketLocationCommand).callsFake((req) => {
    if (req.ExpectedBucketOwner) {
      const err = new Error('Access Denied');
      err.name = 'AccessDenied';
      throw err;
    }
    return {};
  });

  await expect(pub.publish()).resolves.not.toThrow();
});
