import { DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'nested stack with parameters',
  withDefaultFixture(async (fixture) => {
    // STACK_NAME_PREFIX is used in MyTopicParam to allow multiple instances
    // of this test to run in parallel, othewise they will attempt to create the same SNS topic.
    const stackArn = await fixture.cdkDeploy('with-nested-stack-using-parameters', {
      options: ['--parameters', `MyTopicParam=${fixture.stackNamePrefix}ThereIsNoSpoon`],
      captureStderr: false,
    });

    // verify that we only deployed a single stack (there's a single ARN in the output)
    expect(stackArn.split('\n').length).toEqual(1);

    // verify the number of resources in the stack
    const response = await fixture.aws.cloudFormation.send(
      new DescribeStackResourcesCommand({
        StackName: stackArn,
      }),
    );
    expect(response.StackResources?.length).toEqual(1);
  }),
);

