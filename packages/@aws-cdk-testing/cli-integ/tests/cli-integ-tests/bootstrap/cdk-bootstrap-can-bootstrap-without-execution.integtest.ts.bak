import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withoutBootstrap } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('can bootstrap without execution', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapLegacy({
    toolkitStackName: bootstrapStackName,
    noExecute: true,
  });

  const resp = await fixture.aws.cloudFormation.send(
    new DescribeStacksCommand({
      StackName: bootstrapStackName,
    }),
  );

  expect(resp.Stacks?.[0].StackStatus).toEqual('REVIEW_IN_PROGRESS');
}));

