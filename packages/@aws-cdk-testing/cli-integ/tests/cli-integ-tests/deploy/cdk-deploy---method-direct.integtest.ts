import { DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy --method=direct',
  withDefaultFixture(async (fixture) => {
    const stackArn = await fixture.cdkDeploy('test-2', {
      options: ['--method=direct'],
      captureStderr: false,
    });

    // verify the number of resources in the stack
    const response = await fixture.aws.cloudFormation.send(
      new DescribeStackResourcesCommand({
        StackName: stackArn,
      }),
    );
    expect(response.StackResources?.length).toBeGreaterThan(0);
  }),
);

