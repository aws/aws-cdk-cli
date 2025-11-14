import { integTest, withoutBootstrap, randomString } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('upgrade legacy bootstrap stack to new bootstrap stack while in use', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  const legacyBootstrapBucketName = `aws-cdk-bootstrap-integ-test-legacy-bckt-${randomString()}`;
  const newBootstrapBucketName = `aws-cdk-bootstrap-integ-test-v2-bckt-${randomString()}`;
  fixture.rememberToDeleteBucket(legacyBootstrapBucketName); // This one will leak
  fixture.rememberToDeleteBucket(newBootstrapBucketName); // This one shouldn't leak if the test succeeds, but let's be safe in case it doesn't

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

