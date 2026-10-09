import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy with rollback trigger alarm ARNs as flags',
  withDefaultFixture(async (fixture) => {
    const alarmName = `${fixture.stackNamePrefix}-rollback-trigger`;

    const alarmArn = await fixture.aws.temporaryAlarm(alarmName);

    // Monitoring time 0 keeps the deploy fast: the alarm is attached as a rollback
    // trigger but CloudFormation does not bake after the update completes.
    await fixture.cdkDeploy('test-2', {
      options: ['--rollback-trigger-alarm-arns', alarmArn, '--monitoring-time-minutes', '0'],
    });

    // verify that the stack we deployed has our rollback trigger
    const describeResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: fixture.fullStackName('test-2'),
      }),
    );
    const rollbackConfiguration = describeResponse.Stacks?.[0].RollbackConfiguration;
    expect(rollbackConfiguration?.RollbackTriggers).toEqual([
      { Arn: alarmArn, Type: 'AWS::CloudWatch::Alarm' },
    ]);
    // CloudFormation omits a monitoring time of 0 from the response, so treat absent as 0.
    expect(rollbackConfiguration?.MonitoringTimeInMinutes ?? 0).toEqual(0);
  }),
);
