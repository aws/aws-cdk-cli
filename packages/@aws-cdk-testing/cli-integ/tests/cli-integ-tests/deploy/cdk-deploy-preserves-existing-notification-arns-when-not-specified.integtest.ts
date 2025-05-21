import { DescribeStacksCommand, UpdateStackCommand, waitUntilStackUpdateComplete } from '@aws-sdk/client-cloudformation';
import { CreateTopicCommand, DeleteTopicCommand } from '@aws-sdk/client-sns';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('deploy preserves existing notification arns when not specified', withDefaultFixture(async (fixture) => {
  const topicName = `${fixture.stackNamePrefix}-topic`;

  const response = await fixture.aws.sns.send(new CreateTopicCommand({ Name: topicName }));
  const topicArn = response.TopicArn!;

  try {
    await fixture.cdkDeploy('notification-arns');

    // add notification arns externally to cdk
    await fixture.aws.cloudFormation.send(
      new UpdateStackCommand({
        StackName: fixture.fullStackName('notification-arns'),
        UsePreviousTemplate: true,
        NotificationARNs: [topicArn],
      }),
    );

    await waitUntilStackUpdateComplete(
      {
        client: fixture.aws.cloudFormation,
        maxWaitTime: 600,
      },
      { StackName: fixture.fullStackName('notification-arns') },
    );

    // deploy again
    await fixture.cdkDeploy('notification-arns');

    // make sure the notification arn is preserved
    const describeResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: fixture.fullStackName('notification-arns'),
      }),
    );
    expect(describeResponse.Stacks?.[0].NotificationARNs).toEqual([topicArn]);
  } finally {
    await fixture.aws.sns.send(
      new DeleteTopicCommand({
        TopicArn: topicArn,
      }),
    );
  }
}));

