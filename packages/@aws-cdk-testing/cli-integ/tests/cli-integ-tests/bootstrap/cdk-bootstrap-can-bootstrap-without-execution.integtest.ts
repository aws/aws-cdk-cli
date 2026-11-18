import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withoutBootstrap } from '../../../lib';

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

