import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import { GetBucketLocationCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { MockAws, mockS3 } from './mock-aws';
import mockfs from './mock-fs';
import type { IAws } from '../lib';
import { AssetManifest, AssetPublishing } from '../lib';
import { MockProgressListener } from './mock-progress-listener';
import { EventType } from '../lib/progress';

describe('Asset Publishing Logging', () => {
  let aws: IAws;
  let progressListener: MockProgressListener;

  beforeEach(() => {
    // Setup mock filesystem with a simple file asset
    mockfs({
      '/logging-test/cdk.out/assets.json': JSON.stringify({
        version: Manifest.version(),
        files: {
          simpleAsset: {
            source: {
              path: 'simple_file.txt',
            },
            destinations: {
              testDestination: {
                region: 'us-test-1',
                assumeRoleArn: 'arn:aws:role:test',
                bucketName: 'test-bucket',
                objectKey: 'test-key',
              },
            },
          },
        },
      }),
      '/logging-test/cdk.out/simple_file.txt': 'Test file contents',
    });

    // Reset and configure mocks
    aws = new MockAws();
    progressListener = new MockProgressListener();

    mockS3.on(GetBucketLocationCommand).resolves({});
    mockS3.on(ListObjectsV2Command).resolves({ Contents: undefined });
  });

  afterEach(() => {
    mockfs.restore();
  });

  test('receiving normal progress events during publishing', async () => {
    const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/logging-test/cdk.out')), {
      aws,
      progressListener,
    });

    await pub.publish();

    const messages: string[] = progressListener.messages.map((msg) => msg.message);

    // Verify progress events

    expect(progressListener.messages.length).toBeGreaterThan(0);

    // Check that progress events contain percentage and asset details
    expect(messages).toContainEqual('Publishing simpleAsset:testDestination');
    expect(messages).toContainEqual('Check s3://test-bucket/test-key');
    expect(messages).toContainEqual('Upload s3://test-bucket/test-key');
    expect(messages).toContainEqual('Published simpleAsset:testDestination');
  });

  test('handles multiple asset destinations with logging', async () => {
    // Setup mock filesystem with multiple destinations
    mockfs({
      '/multi-dest/cdk.out/assets.json': JSON.stringify({
        version: Manifest.version(),
        files: {
          multiAsset: {
            source: {
              path: 'multi_file.txt',
            },
            destinations: {
              destination1: {
                region: 'us-test-1',
                assumeRoleArn: 'arn:aws:role:test1',
                bucketName: 'test-bucket-1',
                objectKey: 'test-key-1',
              },
              destination2: {
                region: 'us-test-2',
                assumeRoleArn: 'arn:aws:role:test2',
                bucketName: 'test-bucket-2',
                objectKey: 'test-key-2',
              },
            },
          },
        },
      }),
      '/multi-dest/cdk.out/multi_file.txt': 'Multifile contents',
    });

    const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/multi-dest/cdk.out')), {
      aws,
      progressListener,
    });

    await pub.publish();

    // Verify events for both destinations
    const startEvents = progressListener.messages.filter((msg) => msg.type === EventType.START);
    const completeEvents = progressListener.messages.filter(
      (msg) => msg.type === EventType.SUCCESS,
    );

    expect(startEvents.length).toBe(2);
    expect(completeEvents.length).toBe(2);

    // Check that both destinations are mentioned in events
    expect(startEvents[0].message).toContain('multiAsset:destination1');
    expect(startEvents[1].message).toContain('multiAsset:destination2');
    expect(completeEvents[0].message).toContain('multiAsset:destination1');
    expect(completeEvents[1].message).toContain('multiAsset:destination2');
  });
});
