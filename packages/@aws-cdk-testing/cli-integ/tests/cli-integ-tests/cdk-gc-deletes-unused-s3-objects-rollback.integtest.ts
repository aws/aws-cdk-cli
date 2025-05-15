import { ListObjectsV2Command, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { integTest, withoutBootstrap, randomString } from '../../lib';
import { S3_ISOLATED_TAG } from '../../../../@aws-cdk/toolkit-lib/lib/api';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

const DAY = 24 * 60 * 60 * 1000;

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

    // Pretend the asset was tagged with an old date > 1 day ago so that garbage collection
    // should pick up and delete asset even with rollbackBufferDays=1
    const result = await fixture.aws.s3.send(new ListObjectsV2Command({ Bucket: bootstrapBucketName }));
    const key = result.Contents!.filter((c) => c.Key?.split('.')[1] == 'zip')[0].Key; // fancy footwork to make sure we have the asset key
    await fixture.aws.s3.send(new PutObjectTaggingCommand({
      Bucket: bootstrapBucketName,
      Key: key,
      Tagging: {
        TagSet: [{
          Key: S3_ISOLATED_TAG,
          Value: String(Date.now() - (30 * DAY)),
        }],
      },
    }));

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
