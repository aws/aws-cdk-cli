import { PutObjectLockConfigurationCommand } from '@aws-sdk/client-s3';
import { integTest, withoutBootstrap } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('deploy stack with Lambda Asset to Object Lock-enabled asset bucket', withoutBootstrap(async (fixture) => {
  // Bootstrapping with custom toolkit stack name and qualifier
  const qualifier = fixture.qualifier;
  const toolkitStackName = fixture.bootstrapStackName;
  await fixture.cdkBootstrapModern({
    verbose: true,
    toolkitStackName: toolkitStackName,
    qualifier: qualifier,
  });

  const bucketName = `cdk-${qualifier}-assets-${await fixture.aws.account()}-${fixture.aws.region}`;
  await fixture.aws.s3.send(new PutObjectLockConfigurationCommand({
    Bucket: bucketName,
    ObjectLockConfiguration: {
      ObjectLockEnabled: 'Enabled',
      Rule: {
        DefaultRetention: {
          Days: 1,
          Mode: 'GOVERNANCE',
        },
      },
    },
  }));

  // Deploy a stack that definitely contains a file asset
  await fixture.cdkDeploy('lambda', {
    options: [
      '--toolkit-stack-name', toolkitStackName,
      '--context', `@aws-cdk/core:bootstrapQualifier=${qualifier}`,
    ],
  });

  // THEN - should not fail. Now clean the bucket with governance bypass: a regular delete
  // operation will fail.
  await fixture.aws.emptyBucket(bucketName, { bypassGovernance: true });
}));

