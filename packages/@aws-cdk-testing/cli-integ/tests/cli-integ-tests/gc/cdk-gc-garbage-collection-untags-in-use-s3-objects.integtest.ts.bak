import { GetObjectTaggingCommand, ListObjectsV2Command, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { integTest, withoutBootstrap, randomString } from '../../../lib';

const S3_ISOLATED_TAG = 'aws-cdk:isolated';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'Garbage Collection untags in-use s3 objects',
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

    // Artificially add tagging to the asset in the bootstrap bucket
    const result = await fixture.aws.s3.send(new ListObjectsV2Command({ Bucket: bootstrapBucketName }));
    const key = result.Contents!.filter((c) => c.Key?.split('.')[1] == 'zip')[0].Key; // fancy footwork to make sure we have the asset key
    await fixture.aws.s3.send(new PutObjectTaggingCommand({
      Bucket: bootstrapBucketName,
      Key: key,
      Tagging: {
        TagSet: [{
          Key: S3_ISOLATED_TAG,
          Value: '12345',
        }, {
          Key: 'bogus',
          Value: 'val',
        }],
      },
    }));

    await fixture.cdkGarbageCollect({
      rollbackBufferDays: 100, // this will ensure that we do not delete assets immediately (and just tag them)
      type: 's3',
      bootstrapStackName: toolkitStackName,
    });
    fixture.log('Garbage collection complete!');

    // assert that the isolated object tag is removed while the other tag remains
    const newTags = await fixture.aws.s3.send(new GetObjectTaggingCommand({ Bucket: bootstrapBucketName, Key: key }));

    expect(newTags.TagSet).toEqual([{
      Key: 'bogus',
      Value: 'val',
    }]);
  }),
);

