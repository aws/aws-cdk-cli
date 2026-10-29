import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy clears rollback triggers when none is passed',
  withDefaultFixture(async (fixture) => {
    const alarmName = `${fixture.stackNamePrefix}-rollback-trigger`;

    const alarmArn = await fixture.aws.temporaryAlarm(alarmName);

    // Deploy once with a rollback trigger configured.
    await fixture.cdkDeploy('test-2', {
      options: ['--rollback-trigger-alarm-arns', alarmArn, '--monitoring-time-minutes', '0'],
    });

    let describeResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: fixture.fullStackName('test-2'),
      }),
    );
    expect(describeResponse.Stacks?.[0].RollbackConfiguration?.RollbackTriggers).toEqual([
      { Arn: alarmArn, Type: 'AWS::CloudWatch::Alarm' },
    ]);

    // Deploy again passing the literal `none`. This opts in to managing the configuration
    // and clears the previously configured trigger (the flag cannot be passed empty).
    await fixture.cdkDeploy('test-2', {
      options: ['--rollback-trigger-alarm-arns', 'none'],
    });

    // the trigger must have been removed
    describeResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: fixture.fullStackName('test-2'),
      }),
    );
    expect(describeResponse.Stacks?.[0].RollbackConfiguration?.RollbackTriggers ?? []).toEqual([]);
  }),
);
