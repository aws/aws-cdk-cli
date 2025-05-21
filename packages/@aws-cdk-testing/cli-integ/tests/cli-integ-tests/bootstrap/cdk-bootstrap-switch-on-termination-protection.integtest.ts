import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withoutBootstrap } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('switch on termination protection, switch is left alone on re-bootstrap', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapModern({
    verbose: true,
    toolkitStackName: bootstrapStackName,
    terminationProtection: true,
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
  });
  await fixture.cdkBootstrapModern({
    verbose: true,
    toolkitStackName: bootstrapStackName,
    force: true,
  });

  const response = await fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: bootstrapStackName }));
  expect(response.Stacks?.[0].EnableTerminationProtection).toEqual(true);
}));

