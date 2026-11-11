import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withoutBootstrap } from '../../../lib';

integTest('can add tags then update tags during re-bootstrap', withoutBootstrap(async (fixture) => {
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
    tags: 'Foo=BarBaz',
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
    force: true,
  });

  const response = await fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: bootstrapStackName }));
  expect(response.Stacks?.[0].Tags).toEqual([
    { Key: 'Foo', Value: 'BarBaz' },
  ]);
}));

