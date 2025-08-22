import { DescribeStackResourcesCommand, type StackResource } from '@aws-sdk/client-cloudformation';
import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk refactor - detects refactoring changes and executes the refactor',
  withSpecificFixture('refactoring', async (fixture) => {
    // First, deploy a stack
    const stackArn = await fixture.cdkDeploy('basic', {
      modEnv: {
        BASIC_QUEUE_LOGICAL_ID: 'OldName',
      },
    });

    // Then see if the refactoring tool detects the change
    const stdErr = await fixture.cdkRefactor({
      options: ['--unstable=refactor', '--force'],
      allowErrExit: true,
      // Making sure the synthesized stack has a queue with
      // the new name so that a refactor is detected
      modEnv: {
        BASIC_QUEUE_LOGICAL_ID: 'NewName',
      },
    });

    expect(stdErr).toMatch('Stack refactor complete');

    const stackDescription = await fixture.aws.cloudFormation.send(
      new DescribeStackResourcesCommand({
        StackName: getStackNameFromArn(stackArn),
      }),
    );

    const resources = Object.fromEntries(
      (stackDescription.StackResources ?? []).map(
        (resource) => [resource.LogicalResourceId!, resource] as [string, StackResource],
      ),
    );

    expect(resources.NewName57B171FE).toBeDefined();

    // CloudFormation may complete the refactoring, while the stack is still in the "UPDATE_IN_PROGRESS" state.
    // Give it a couple of seconds to finish the update.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }),
);

export function getStackNameFromArn(stackArn: string): string {
  // Example ARN: arn:aws:cloudformation:region:account-id:stack/stack-name/guid
  const arnParts = stackArn.split(':');
  const resource = arnParts[5]; // "stack/stack-name/guid"
  const resourceParts = resource.split('/');
  // The stack name is the second part: ["stack", "stack-name", "guid"]
  return resourceParts[1];
}
