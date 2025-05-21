import { DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withCliLibFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cli-lib deploy',
  withCliLibFixture(async (fixture) => {
    const stackName = fixture.fullStackName('simple-1');

    try {
      // deploy the stack
      await fixture.cdk(['deploy', stackName], {
        neverRequireApproval: true,
      });

      // verify the number of resources in the stack
      const expectedStack = await fixture.aws.cloudFormation.send(
        new DescribeStackResourcesCommand({
          StackName: stackName,
        }),
      );
      expect(expectedStack.StackResources?.length).toEqual(3);
    } finally {
      // delete the stack
      await fixture.cdk(['destroy', stackName], {
        captureStderr: false,
      });
    }
  }),
);

