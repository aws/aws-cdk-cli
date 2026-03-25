import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'destroy all concurrently',
  withDefaultFixture(async (fixture) => {
    // Deploy two independent stacks
    await fixture.cdkDeploy(['test-1', 'test-2']);

    // Destroy both concurrently
    await fixture.cdkDestroy('test-*', { options: ['--concurrency', '2'] });

    // Assert both stacks are gone
    await expect(fixture.aws.cloudFormation.send(new DescribeStacksCommand({
      StackName: fixture.fullStackName('test-1'),
    }))).rejects.toThrow(/does not exist/);

    await expect(fixture.aws.cloudFormation.send(new DescribeStacksCommand({
      StackName: fixture.fullStackName('test-2'),
    }))).rejects.toThrow(/does not exist/);
  }),
);
