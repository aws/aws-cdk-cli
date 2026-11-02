import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest('deploy deletes ALL notification arns when empty array is passed', withDefaultFixture(async (fixture) => {
  const topicName = `${fixture.stackNamePrefix}-topic`;
  const topicArn = await fixture.aws.temporaryTopic(topicName);

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
}));

