import { integTest, withoutBootstrap } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

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
}));

