import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy with notification ARN as flag',
  withDefaultFixture(async (fixture) => {
    const topicName = `${fixture.stackNamePrefix}-test-topic-flag`;

    const topicArn = await fixture.aws.temporaryTopic(topicName);

    await fixture.cdkDeploy('notification-arns', {
      options: ['--notification-arns', topicArn],
    });

    // verify that the stack we deployed has our notification ARN
    const describeResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: fixture.fullStackName('notification-arns'),
      }),
    );
    expect(describeResponse.Stacks?.[0].NotificationARNs).toEqual([topicArn]);
  }),
);

