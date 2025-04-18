import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { CreateTopicCommand, DeleteTopicCommand } from '@aws-sdk/client-sns';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('deploy with notification ARN as prop and flag', withDefaultFixture(async (fixture) => {
  const topic1Name = `${fixture.stackNamePrefix}-topic1`;
  const topic2Name = `${fixture.stackNamePrefix}-topic1`;

  const topic1Arn = (await fixture.aws.sns.send(new CreateTopicCommand({ Name: topic1Name }))).TopicArn!;
  const topic2Arn = (await fixture.aws.sns.send(new CreateTopicCommand({ Name: topic2Name }))).TopicArn!;

  try {
    await fixture.cdkDeploy('notification-arns', {
      modEnv: {
        INTEG_NOTIFICATION_ARNS: topic1Arn,

      },
      options: ['--notification-arns', topic2Arn],
    });

    // verify that the stack we deployed has our notification ARN
    const describeResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: fixture.fullStackName('notification-arns'),
      }),
    );
    expect(describeResponse.Stacks?.[0].NotificationARNs).toEqual([topic1Arn, topic2Arn]);
  } finally {
    await fixture.aws.sns.send(
      new DeleteTopicCommand({
        TopicArn: topic1Arn,
      }),
    );
    await fixture.aws.sns.send(
      new DeleteTopicCommand({
        TopicArn: topic2Arn,
      }),
    );
  }
}));

// NOTE: this doesn't currently work with modern-style synthesis, as the bootstrap
// role by default will not have permission to iam:PassRole the created role.
