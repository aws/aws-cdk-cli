import { ListObjectsV2Command, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { integTest, withoutBootstrap, randomString } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

const DAY = 24 * 60 * 60 * 1000;
const S3_ISOLATED_TAG = 'aws-cdk:isolated';

integTest(
  'Garbage Collection deletes unused s3 objects with rollback-buffer-days',
  withoutBootstrap(async (fixture) => {
    const toolkitStackName = fixture.bootstrapStackName;
    const bootstrapBucketName = `aws-cdk-garbage-collect-integ-test-bckt-${randomString()}`;
    fixture.rememberToDeleteBucket(bootstrapBucketName); // just in case

    await fixture.cdkBootstrapModern({
      toolkitStackName,
      bootstrapBucketName,
    });

    await fixture.cdkDeploy('lambda', {
      options: [
        '--context', `bootstrapBucket=${bootstrapBucketName}`,
        '--context', `@aws-cdk/core:bootstrapQualifier=${fixture.qualifier}`,
        '--toolkit-stack-name', toolkitStackName,
        '--force',
      ],
    });
    fixture.log('Setup complete!');

    await fixture.cdkDestroy('lambda', {
      options: [
        '--context', `bootstrapBucket=${bootstrapBucketName}`,
        '--context', `@aws-cdk/core:bootstrapQualifier=${fixture.qualifier}`,
        '--toolkit-stack-name', toolkitStackName,
        '--force',
      ],
    });

    // Pretend the assets were tagged with an old date > 1 day ago so that garbage collection
    // should pick up and delete asset even with rollbackBufferDays=1
    const res = await fixture.aws.s3.send(new ListObjectsV2Command({ Bucket: bootstrapBucketName }));
    for (const contents of res.Contents ?? []) {
      await fixture.aws.s3.send(new PutObjectTaggingCommand({
        Bucket: bootstrapBucketName,
        Key: contents.Key,
        Tagging: {
          TagSet: [{
            Key: S3_ISOLATED_TAG,
            Value: String(Date.now() - (30 * DAY)),
          }],
        },
      }));
    }

    await fixture.cdkGarbageCollect({
      rollbackBufferDays: 1,
      type: 's3',
      bootstrapStackName: toolkitStackName,
    });
    fixture.log('Garbage collection complete!');

    // assert that the bootstrap bucket is empty
    await fixture.aws.s3.send(new ListObjectsV2Command({ Bucket: bootstrapBucketName }))
      .then((result) => {
        expect(result.Contents).toBeUndefined();
      });
  }),
);
