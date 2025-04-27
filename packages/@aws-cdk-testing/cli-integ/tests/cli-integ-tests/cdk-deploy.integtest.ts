import { DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy',
  withDefaultFixture(async (fixture) => {
    const stackArn = await fixture.cdkDeploy('test-2', { captureStderr: false });

    // verify the number of resources in the stack
    const response = await fixture.aws.cloudFormation.send(
      new DescribeStackResourcesCommand({
        StackName: stackArn,
      }),
    );
    expect(response.StackResources?.length).toEqual(2);
  }),
);

