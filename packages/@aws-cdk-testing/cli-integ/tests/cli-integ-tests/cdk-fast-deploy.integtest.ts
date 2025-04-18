import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'fast deploy',
  withDefaultFixture(async (fixture) => {
    // we are using a stack with a nested stack because CFN will always attempt to
    // update a nested stack, which will allow us to verify that updates are actually
    // skipped unless --force is specified.
    const stackArn = await fixture.cdkDeploy('with-nested-stack', { captureStderr: false });
    const changeSet1 = await getLatestChangeSet();

    // Deploy the same stack again, there should be no new change set created
    await fixture.cdkDeploy('with-nested-stack');
    const changeSet2 = await getLatestChangeSet();
    expect(changeSet2.ChangeSetId).toEqual(changeSet1.ChangeSetId);

    // Deploy the stack again with --force, now we should create a changeset
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

