import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withoutBootstrap } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('can remove trusted account', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapModern({
    verbose: false,
    toolkitStackName: bootstrapStackName,
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
    trust: ['599757620138', '730170552321'],
  });

  await fixture.cdkBootstrapModern({
    verbose: true,
    toolkitStackName: bootstrapStackName,
    cfnExecutionPolicy: ' arn:aws:iam::aws:policy/AdministratorAccess',
    untrust: ['730170552321'],
  });

  const response = await fixture.aws.cloudFormation.send(
    new DescribeStacksCommand({ StackName: bootstrapStackName }),
  );

  const trustedAccounts = response.Stacks?.[0].Parameters?.find(p => p.ParameterKey === 'TrustedAccounts')?.ParameterValue;
  expect(trustedAccounts).toEqual('599757620138');
}));

