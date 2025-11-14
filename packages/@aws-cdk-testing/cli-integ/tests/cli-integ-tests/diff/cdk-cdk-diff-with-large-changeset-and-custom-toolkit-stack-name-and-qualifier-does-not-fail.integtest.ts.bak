import { integTest, withoutBootstrap } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('cdk diff with large changeset and custom toolkit stack name and qualifier does not fail', withoutBootstrap(async (fixture) => {
  // Bootstrapping with custom toolkit stack name and qualifier
  const qualifier = fixture.qualifier;

  const toolkitStackName = fixture.bootstrapStackName;
  await fixture.cdkBootstrapModern({
    verbose: true,
    toolkitStackName: toolkitStackName,
    qualifier: qualifier,
  });

  // Deploying small initial stack with only one IAM role
  await fixture.cdkDeploy('iam-roles', {
    modEnv: {
      NUMBER_OF_ROLES: '1',
    },
    options: [
      '--toolkit-stack-name', toolkitStackName,
      '--context', `@aws-cdk/core:bootstrapQualifier=${qualifier}`,
    ],
  });

  // WHEN - adding a role with a ton of metadata to create a large diff
  const diff = await fixture.cdk(['diff', '--toolkit-stack-name', toolkitStackName, '--context', `@aws-cdk/core:bootstrapQualifier=${qualifier}`, fixture.fullStackName('iam-roles')], {
    verbose: true,
    modEnv: {
      NUMBER_OF_ROLES: '2',
    },
  });

  // Assert that the CLI assumes the file publishing role:
  expect(diff).toMatch(/Assuming role .*file-publishing-role/);
  expect(diff).toContain('success: Published');
}));

