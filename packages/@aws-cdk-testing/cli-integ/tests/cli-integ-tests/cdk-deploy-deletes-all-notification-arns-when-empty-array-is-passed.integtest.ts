import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { CreateTopicCommand, DeleteTopicCommand } from '@aws-sdk/client-sns';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('deploy deletes ALL notification arns when empty array is passed', withDefaultFixture(async (fixture) => {
  const topicName = `${fixture.stackNamePrefix}-topic`;

  const response = await fixture.aws.sns.send(new CreateTopicCommand({ Name: topicName }));
  const topicArn = response.TopicArn!;

  try {
    await fixture.cdkDeploy('notification-arns', {
      modEnv: {
        INTEG_NOTIFICATION_ARNS: topicArn,
      },
    });

    // make sure the arn was added
    let describeResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: fixture.fullStackName('notification-arns'),
      }),
    );
    expect(describeResponse.Stacks?.[0].NotificationARNs).toEqual([topicArn]);

    // deploy again with empty array
    await fixture.cdkDeploy('notification-arns', {
      modEnv: {
        INTEG_NOTIFICATION_ARNS: '',
      },
    });

    // make sure the arn was deleted
    describeResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: fixture.fullStackName('notification-arns'),
      }),
    );
    expect(describeResponse.Stacks?.[0].NotificationARNs).toEqual([]);
  } finally {
    await fixture.aws.sns.send(
      new DeleteTopicCommand({
        TopicArn: topicArn,
      }),
    );
  }
}));

