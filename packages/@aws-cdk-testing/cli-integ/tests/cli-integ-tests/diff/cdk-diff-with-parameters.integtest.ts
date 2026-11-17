import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff uses supplied CloudFormation parameters',
  withDefaultFixture(async (fixture) => {
    const stackName = fixture.fullStackName('param-test-1');
    const topicName = `${fixture.stackNamePrefix}diff-parameters`;
    await fixture.cdkDeploy('param-test-1', {
      options: ['--parameters', `TopicNameParam=${topicName}`],
    });

    const unchanged = await fixture.cdk([
      'diff', stackName, '--method=change-set', '--fail-on=any-change',
      '--parameters', `${stackName}:TopicNameParam=${topicName}`,
    ]);
    expect(unchanged).toContain('There were no differences');

    const changed = await fixture.cdk([
      'diff', stackName, '--method=change-set', '--fail-on=never',
      '--parameters', `${stackName}:TopicNameParam=${topicName}-changed`,
    ]);
    expect(changed).toContain('AWS::SNS::Topic');
    expect(changed).not.toContain('There were no differences');
  }),
);
