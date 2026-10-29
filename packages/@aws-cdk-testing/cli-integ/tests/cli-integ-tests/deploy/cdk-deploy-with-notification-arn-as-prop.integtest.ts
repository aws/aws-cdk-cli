import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest('deploy with notification ARN as prop', withDefaultFixture(async (fixture) => {
  const topicName = `${fixture.stackNamePrefix}-test-topic-prop`;

  const topicArn = await fixture.aws.temporaryTopic(topicName);

  await fixture.cdkDeploy('notification-arns', {
    modEnv: {
      INTEG_NOTIFICATION_ARNS: topicArn,

    },
  });

  // verify that the stack we deployed has our notification ARN
  const describeResponse = await fixture.aws.cloudFormation.send(
    new DescribeStacksCommand({
      StackName: fixture.fullStackName('notification-arns'),
    }),
  );
  expect(describeResponse.Stacks?.[0].NotificationARNs).toEqual([topicArn]);
}));

// https://github.com/aws/aws-cdk/issues/32153
