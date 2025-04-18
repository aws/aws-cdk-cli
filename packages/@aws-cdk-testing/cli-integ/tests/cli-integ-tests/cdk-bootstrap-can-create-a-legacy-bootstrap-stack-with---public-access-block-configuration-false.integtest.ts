import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withoutBootstrap } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('can create a legacy bootstrap stack with --public-access-block-configuration=false', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapLegacy({
    verbose: true,
    toolkitStackName: bootstrapStackName,
    publicAccessBlockConfiguration: false,
    tags: 'Foo=Bar',
  });

  const response = await fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: bootstrapStackName }));
  expect(response.Stacks?.[0].Tags).toEqual([
    { Key: 'Foo', Value: 'Bar' },
  ]);
}));

