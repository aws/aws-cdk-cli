import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'destroy with concurrency respects dependency ordering',
  withDefaultFixture(async (fixture) => {
    // Deploy the consuming stack which will include the producing stack
    await fixture.cdkDeploy('order-consuming');

    // Destroy the providing stack with concurrency, which must destroy
    // the consuming stack first due to reversed dependency ordering
    await fixture.cdkDestroy('order-providing', { options: ['--concurrency', '2'] });

    // Assert both stacks are gone
    await expect(fixture.aws.cloudFormation.send(new DescribeStacksCommand({
      StackName: fixture.fullStackName('order-consuming'),
    }))).rejects.toThrow(/does not exist/);

    await expect(fixture.aws.cloudFormation.send(new DescribeStacksCommand({
      StackName: fixture.fullStackName('order-providing'),
    }))).rejects.toThrow(/does not exist/);
  }),
);
