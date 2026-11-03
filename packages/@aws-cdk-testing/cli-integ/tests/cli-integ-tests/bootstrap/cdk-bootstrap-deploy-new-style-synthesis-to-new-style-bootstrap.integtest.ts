import { integTest, withoutBootstrap } from '../../../lib';

integTest('deploy new style synthesis to new style bootstrap', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapModern({
    toolkitStackName: bootstrapStackName,
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
  });

  // Deploy stack that uses file assets
  await fixture.cdkDeploy('lambda', {
    options: [
      '--toolkit-stack-name', bootstrapStackName,
      '--context', `@aws-cdk/core:bootstrapQualifier=${fixture.qualifier}`,
      '--context', '@aws-cdk/core:newStyleStackSynthesis=1',
    ],
  });
}, {
  // This test does not pull a public ECR image, so skip the ECR login.
  setup: { ecrLogin: false },
}));

