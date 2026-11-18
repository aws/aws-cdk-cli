import { integTest, withoutBootstrap } from '../../../lib';

integTest('can and deploy if omitting execution policies', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapModern({
    toolkitStackName: bootstrapStackName,
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

