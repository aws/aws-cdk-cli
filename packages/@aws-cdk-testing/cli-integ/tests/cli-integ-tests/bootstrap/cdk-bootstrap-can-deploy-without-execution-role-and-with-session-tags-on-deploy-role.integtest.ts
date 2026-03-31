import * as path from 'path';
import { integTest, withoutBootstrap } from '../../../lib';

integTest('can deploy without execution role and with session tags on deploy role', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapModern({
    toolkitStackName: bootstrapStackName,
    bootstrapTemplate: path.join(__dirname, '..', '..', '..', 'resources', 'bootstrap-templates', 'session-tags.deploy-role-deny-sqs.yaml'),
  });

  await fixture.cdkDeploy('session-tags-with-custom-synthesizer', {
    options: [
      '--toolkit-stack-name', bootstrapStackName,
      '--context', `@aws-cdk/core:bootstrapQualifier=${fixture.qualifier}`,
      '--context', '@aws-cdk/core:newStyleStackSynthesis=1',
    ],
  });
}));

