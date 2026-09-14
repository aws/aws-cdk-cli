import { integTest, withoutBootstrap, randomString } from '../../../lib';

integTest('upgrade legacy bootstrap stack to new bootstrap stack while in use', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  const legacyBootstrapBucketName = `aws-cdk-bootstrap-integ-test-legacy-bckt-${randomString()}`;
  const newBootstrapBucketName = `aws-cdk-bootstrap-integ-test-v2-bckt-${randomString()}`;
  fixture.cleanupUnmanagedResource({ type: 'bucket', bucketName: legacyBootstrapBucketName }); // This one will leak

  // Legacy bootstrap
  await fixture.cdkBootstrapLegacy({
    toolkitStackName: bootstrapStackName,
    bootstrapBucketName: legacyBootstrapBucketName,
  });

  // Deploy stack that uses file assets
  await fixture.cdkDeploy('lambda', {
    options: [
      '--context', `bootstrapBucket=${legacyBootstrapBucketName}`,
      '--context', 'legacySynth=true',
      '--context', `@aws-cdk/core:bootstrapQualifier=${fixture.qualifier}`,
      '--toolkit-stack-name', bootstrapStackName,
    ],
  });

  // Upgrade bootstrap stack to "new" style
  await fixture.cdkBootstrapModern({
    toolkitStackName: bootstrapStackName,
    bootstrapBucketName: newBootstrapBucketName,
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
  });

  // (Force) deploy stack again
  // --force to bypass the check which says that the template hasn't changed.
  await fixture.cdkDeploy('lambda', {
    options: [
      '--context', `bootstrapBucket=${newBootstrapBucketName}`,
      '--context', `@aws-cdk/core:bootstrapQualifier=${fixture.qualifier}`,
      '--toolkit-stack-name', bootstrapStackName,
      '--force',
    ],
  });
}));

