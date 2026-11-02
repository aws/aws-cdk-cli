import { DescribeStacksCommand, UpdateStackCommand, waitUntilStackUpdateComplete } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest('deploy preserves existing notification arns when not specified', withDefaultFixture(async (fixture) => {
  const topicName = `${fixture.stackNamePrefix}-topic`;

  const topicArn = await fixture.aws.temporaryTopic(topicName);

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
}));

