import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withoutBootstrap } from '../../../lib';

integTest('add tags, left alone on re-bootstrap', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapModern({
    verbose: true,
    toolkitStackName: bootstrapStackName,
    tags: 'Foo=Bar',
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
  });
  await fixture.cdkBootstrapModern({
    verbose: true,
    toolkitStackName: bootstrapStackName,
    force: true,
  });

  const response = await fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: bootstrapStackName }));
  expect(response.Stacks?.[0].Tags).toEqual([
    { Key: 'Foo', Value: 'Bar' },
  ]);
}, {
  // This test only bootstraps and inspects the stack; it never synthesizes or
  // deploys an app, so skip the app clone, the framework install, and ECR login.
  setup: { cloneApp: false, installPackages: false, ecrLogin: false },
}));

