import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy preserves existing rollback triggers when not specified',
  withDefaultFixture(async (fixture) => {
    const alarmName = `${fixture.stackNamePrefix}-rollback-trigger`;

    const alarmArn = await fixture.aws.temporaryAlarm(alarmName);

    // Deploy once with a rollback trigger so the stack has one configured.
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

    // Deploy again without any rollback flags. CDK must not manage (and therefore not
    // clear) the rollback configuration it was not asked to set.
    await fixture.cdkDeploy('test-2');

    // the previously configured trigger must still be there
    describeResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: fixture.fullStackName('test-2'),
      }),
    );
    expect(describeResponse.Stacks?.[0].RollbackConfiguration?.RollbackTriggers).toEqual([
      { Arn: alarmArn, Type: 'AWS::CloudWatch::Alarm' },
    ]);
  }),
);
