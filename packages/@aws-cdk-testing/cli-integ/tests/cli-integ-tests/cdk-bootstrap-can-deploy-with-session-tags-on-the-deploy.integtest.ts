import * as path from 'path';
import { integTest, withoutBootstrap } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('can deploy with session tags on the deploy, lookup, file asset, and image asset publishing roles', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapModern({
    toolkitStackName: bootstrapStackName,
    bootstrapTemplate: path.join(__dirname, '..', '..', 'resources', 'bootstrap-templates', 'session-tags.all-roles-deny-all.yaml'),
  });

  await fixture.cdkDeploy('session-tags', {
    options: [
      '--toolkit-stack-name', bootstrapStackName,
      '--context', `@aws-cdk/core:bootstrapQualifier=${fixture.qualifier}`,
      '--context', '@aws-cdk/core:newStyleStackSynthesis=1',
    ],
    modEnv: {
      ENABLE_VPC_TESTING: 'IMPORT',
    },
  });
}));

