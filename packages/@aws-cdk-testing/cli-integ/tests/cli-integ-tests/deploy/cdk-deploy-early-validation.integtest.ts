import { randomUUID } from 'node:crypto';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy - early validation error',
  withDefaultFixture(async (fixture) => {
    const bucketName = randomUUID();

    // First, deploy a stack that creates a bucket with a custom name,
    // which we expect to succeed
    await fixture.cdkDeploy('early-validation-stack1', {
      modEnv: {
        BUCKET_NAME: bucketName,
      },
    });

    // Then deploy a different instance of the stack, that creates another
    // bucket with the same name, to induce an early validation error
    const stdErr = await fixture.cdkDeploy('early-validation-stack2', {
      modEnv: {
        BUCKET_NAME: bucketName,
      },
      allowErrExit: true,
    });

    expect(stdErr).toContain(`Resource of type 'AWS::S3::Bucket' with identifier '${bucketName}' already exists`,
    );
  }),
);

