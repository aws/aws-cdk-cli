import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy skips unnecessary updates for nested stacks',
  withDefaultFixture(async (fixture) => {
    // Deploy a stack with nested stacks. With IncludeNestedStacks, CloudFormation
    // can accurately detect whether nested stacks have actual changes, rather than
    // always reporting them as needing an update.
    const stackArn = await fixture.cdkDeploy('with-nested-stack', { captureStderr: false });
    const changeSet1 = await getLatestChangeSet();

    // Deploy the same stack again, there should be no new change set created
    await fixture.cdkDeploy('with-nested-stack');
    const changeSet2 = await getLatestChangeSet();
    expect(changeSet2.ChangeSetId).toEqual(changeSet1.ChangeSetId);

    // Deploy the stack again with --force. CloudFormation creates a changeset but
    // accurately reports no changes (including in nested stacks), so the changeset
    // is not executed and the stack's ChangeSetId remains the same.
    const forceOutput = await fixture.cdk(
      fixture.cdkDeployCommandLine('with-nested-stack', { options: ['--force'] }),
    );
    expect(forceOutput).toContain('CloudFormation reported that the deployment would not make any changes');
    const changeSet3 = await getLatestChangeSet();
    expect(changeSet3.ChangeSetId).toEqual(changeSet2.ChangeSetId);

    // Deploy the stack again with tags, expected to create a new changeset
    // even though the resources didn't change.
    await fixture.cdkDeploy('with-nested-stack', { options: ['--tags', 'key=value'] });
    const changeSet4 = await getLatestChangeSet();
    expect(changeSet4.ChangeSetId).not.toEqual(changeSet3.ChangeSetId);

    async function getLatestChangeSet() {
      const response = await fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: stackArn }));
      if (!response.Stacks?.[0]) {
        throw new Error('Did not get a ChangeSet at all');
      }
      fixture.log(`Found Change Set ${response.Stacks?.[0].ChangeSetId}`);
      return response.Stacks?.[0];
    }
  }),
);
