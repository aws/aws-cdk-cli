import { ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk deploy --require-approval=destructive does not prompt for ignored resources',
  withSpecificFixture('destructive-changes-app', async (fixture) => {
    const stackName = 'destructive-changes';

    // GIVEN
    await fixture.cdkDeploy(stackName);

    // WHEN - the deployment deletes a queue that is ignored by its resource type.
    // stdin is /dev/null, so there is no TTY: a deployment that requires approval would fail.
    const output = await fixture.cdkDeploy(stackName, {
      options: ['--require-approval=destructive', '--ignore-destructive', 'AWS::SQS::Queue', '<', '/dev/null'],
      neverRequireApproval: false,
      modEnv: { DESTRUCTIVE_CHANGES_REMOVE_QUEUE: 'true' },
    });

    // THEN - the deployment says that it ignored the change, went through without asking, and the queue is gone
    expect(output).toContain('all 1 destructive change(s) are ignored by --ignore-destructive (--require-approval=destructive)');
    const resources = await fixture.aws.cloudFormation.send(new ListStackResourcesCommand({
      StackName: fixture.fullStackName(stackName),
    }));
    expect(resources.StackResourceSummaries?.map((r) => r.LogicalResourceId)).not.toContainEqual(expect.stringMatching(/^RemovedQueue/));
  }),
);
