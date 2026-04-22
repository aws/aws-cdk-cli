import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy skips unnecessary updates for nested stacks',
  withDefaultFixture(async (fixture) => {
    // Deploy a stack with a nested stack. CFN will always report nested
    // stacks as changed, even when nothing actually changed. With the
    // two-phase change set flow, this means every deploy creates and
    // executes a new change set.
    const stackArn = await fixture.cdkDeploy('with-nested-stack', { captureStderr: false });

    // Deploy the same stack again — CFN always reports nested stack
    // resources as changed, so the deploy goes through successfully
    // without any actual resource changes.
    await fixture.cdkDeploy('with-nested-stack');
    const changeSet2 = await getLatestChangeSet();
    expect(changeSet2.StackStatus).toEqual('UPDATE_COMPLETE');

    // Deploy the stack again with --force
    await fixture.cdkDeploy('with-nested-stack', { options: ['--force'] });
    const changeSet3 = await getLatestChangeSet();
    expect(changeSet3.ChangeSetId).not.toEqual(changeSet2.ChangeSetId);

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
