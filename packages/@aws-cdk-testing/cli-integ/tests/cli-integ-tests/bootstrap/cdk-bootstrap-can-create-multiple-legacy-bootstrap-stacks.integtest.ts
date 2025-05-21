import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withoutBootstrap } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('can create multiple legacy bootstrap stacks', withoutBootstrap(async (fixture) => {
  const bootstrapStackName1 = `${fixture.bootstrapStackName}-1`;
  const bootstrapStackName2 = `${fixture.bootstrapStackName}-2`;

  // deploy two toolkit stacks into the same environment (see #1416)
  // one with tags
  await fixture.cdkBootstrapLegacy({
    verbose: true,
    toolkitStackName: bootstrapStackName1,
    tags: 'Foo=Bar',
  });
  await fixture.cdkBootstrapLegacy({
    verbose: true,
    toolkitStackName: bootstrapStackName2,
  });

  const response = await fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: bootstrapStackName1 }));
  expect(response.Stacks?.[0].Tags).toEqual([
    { Key: 'Foo', Value: 'Bar' },
  ]);
}));

