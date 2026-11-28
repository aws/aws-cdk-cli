import { integTest, withoutBootstrap } from '../../../lib';

integTest('deploy old style synthesis to new style bootstrap', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapModern({
    toolkitStackName: bootstrapStackName,
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
  });

  // Deploy stack that uses file assets
  await fixture.cdkDeploy('lambda', {
    options: [
      '--context', `@aws-cdk/core:bootstrapQualifier=${fixture.qualifier}`,
      '--toolkit-stack-name', bootstrapStackName,
    ],
  });
}));

