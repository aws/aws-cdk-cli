import { DescribeStackResourcesCommand, ListStacksCommand, type StackResource } from '@aws-sdk/client-cloudformation';
import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk refactor - moves a referenced resource to a different stack',
  withSpecificFixture('refactoring', async (fixture) => {
    // First, deploy a stack
    const originalStackArn = await fixture.cdkDeploy('basic');
    const originalStackInfo = getStackInfoFromArn(originalStackArn);
    const stackPrefix = originalStackInfo.name.replace(/-basic$/, '');

    // Then see if the refactoring tool detects the change
    const stdErr = await fixture.cdkRefactor({
      options: ['--unstable=refactor', '--force'],
      allowErrExit: true,
      // Making sure the synthesized stack has a queue with
      // the new name so that a refactor is detected
      modEnv: {
        BUCKET_IN_SEPARATE_STACK: 'true',
      },
    });

    expect(stdErr).toMatch('Stack refactor complete');

    const stacks = await fixture.aws.cloudFormation.send(new ListStacksCommand());

    const bucketStack = (stacks.StackSummaries ?? []).find((s) => s.StackName === `${stackPrefix}-bucket-stack`);

    expect(bucketStack).toBeDefined();

    const stackDescription = await fixture.aws.cloudFormation.send(
      new DescribeStackResourcesCommand({
        StackName: bucketStack!.StackName,
      }),
    );

    const resources = Object.fromEntries(
      (stackDescription.StackResources ?? []).map(
        (resource) => [resource.LogicalResourceId!, resource] as [string, StackResource],
      ),
    );

    expect(resources.Bucket83908E77).toBeDefined();

    // CloudFormation may complete the refactoring, while the stack is still in the "UPDATE_IN_PROGRESS" state.
    // Give it a couple of seconds to finish the update.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }),
);

interface StackInfo {
  readonly account: string;
  readonly region: string;
  readonly name: string;
}

export function getStackInfoFromArn(stackArn: string): StackInfo {
  // Example ARN: arn:aws:cloudformation:region:account-id:stack/stack-name/guid
  const arnParts = stackArn.split(':');
  const resource = arnParts[5]; // "stack/stack-name/guid"
  const resourceParts = resource.split('/');
  // The stack name is the second part: ["stack", "stack-name", "guid"]
  return {
    region: arnParts[3],
    account: arnParts[4],
    name: resourceParts[1],
  };
}

