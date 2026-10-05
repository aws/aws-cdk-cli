import { ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk deploy --require-approval=destructive only prompts for replacement or deletion',
  withSpecificFixture('destructive-changes-app', async (fixture) => {
    const stackName = 'destructive-changes';

    // GIVEN
    await fixture.cdkDeploy(stackName);

    // Redirect /dev/null to stdin, so there is no TTY attached: a deployment that
    // requires approval fails immediately instead of waiting for a confirmation.
    const noTtyApproval = {
      options: ['--require-approval=destructive', '<', '/dev/null'],
      neverRequireApproval: false,
    };

    // WHEN - the only change updates a resource in place, no approval is needed
    await fixture.cdkDeploy(stackName, {
      ...noTtyApproval,
      modEnv: { DESTRUCTIVE_CHANGES_VISIBILITY_TIMEOUT: '60' },
    });

    // WHEN - the change replaces one resource and deletes another, approval is required
    const output = await fixture.cdkDeploy(stackName, {
      ...noTtyApproval,
      modEnv: {
        DESTRUCTIVE_CHANGES_VISIBILITY_TIMEOUT: '60',
        DESTRUCTIVE_CHANGES_QUEUE_NAME: `cdktest-${fixture.randomString}-replaced`,
        DESTRUCTIVE_CHANGES_REMOVE_QUEUE: 'true',
      },
      allowErrExit: true,
    });

    // THEN - the deployment lists the destructive changes and stops because it cannot ask for approval
    expect(output).toMatch(/: AWS::SQS::Queue ReplacedQueue ReplacedQueue\w+ will be replaced/);
    expect(output).toMatch(/: AWS::SQS::Queue RemovedQueue RemovedQueue\w+ will be destroyed/);
    expect(output).toContain('Stack includes destructive updates');
    expect(output).toContain('terminal (TTY) is not attached');

    // ...and the queue that would have been deleted is still there
    const resources = await fixture.aws.cloudFormation.send(new ListStackResourcesCommand({
      StackName: fixture.fullStackName(stackName),
    }));
    expect(resources.StackResourceSummaries?.map((r) => r.LogicalResourceId)).toContainEqual(expect.stringMatching(/^RemovedQueue/));
  }),
);
