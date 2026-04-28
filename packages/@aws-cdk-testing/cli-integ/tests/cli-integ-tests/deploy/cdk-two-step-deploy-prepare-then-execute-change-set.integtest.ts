import { DescribeChangeSetCommand, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'two-step deploy: prepare then execute change set',
  withDefaultFixture(async (fixture) => {
    const changeSetName = `review-${fixture.stackNamePrefix}`;
    const stackName = 'test-2';
    const fullStackName = fixture.fullStackName(stackName);

    // Step 1: Create the change set without executing it
    await fixture.cdkDeploy(stackName, {
      options: ['--method=prepare-change-set', '--change-set-name', changeSetName],
      captureStderr: false,
    });

    // Verify the stack is in REVIEW_IN_PROGRESS
    const describeResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({ StackName: fullStackName }),
    );
    expect(describeResponse.Stacks?.[0].StackStatus).toEqual('REVIEW_IN_PROGRESS');

    // Verify the change set exists and is ready
    const changeSetResponse = await fixture.aws.cloudFormation.send(
      new DescribeChangeSetCommand({
        StackName: fullStackName,
        ChangeSetName: changeSetName,
      }),
    );
    expect(changeSetResponse.Status).toEqual('CREATE_COMPLETE');

    // Step 2: Execute the change set
    await fixture.cdk([
      'deploy',
      '--require-approval=never',
      '--method=execute-change-set',
      '--change-set-name', changeSetName,
      '--progress', 'events',
      fullStackName,
    ]);

    // Verify the stack is now deployed
    const finalResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({ StackName: fullStackName }),
    );
    expect(finalResponse.Stacks?.[0].StackStatus).toEqual('CREATE_COMPLETE');
  }),
);
