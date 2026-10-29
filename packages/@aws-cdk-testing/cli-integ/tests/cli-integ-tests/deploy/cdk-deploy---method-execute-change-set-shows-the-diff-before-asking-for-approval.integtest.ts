import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk deploy --method=execute-change-set shows the diff before asking for approval',
  withDefaultFixture(async (fixture) => {
    const changeSetName = `review-${fixture.stackNamePrefix}`;
    const stackName = 'test-2';

    // GIVEN - a change set that creates the stack
    await fixture.cdkDeploy(stackName, {
      options: ['--method=prepare-change-set', '--change-set-name', changeSetName],
      captureStderr: false,
    });

    // WHEN - the change set is executed with approval required, and --yes answers the question
    const output = await fixture.cdk([
      'deploy',
      '--require-approval=any-change',
      '--yes',
      '--method=execute-change-set',
      '--change-set-name', changeSetName,
      fixture.fullStackName(stackName),
    ], { modEnv: { FORCE_COLOR: '0' } });

    // THEN - the diff of the change set is shown in front of the question
    const question = output.indexOf('Do you wish to deploy these changes? (auto-confirmed)');
    const diff = output.indexOf('AWS::SNS::Topic');
    expect(question).toBeGreaterThan(-1);
    expect(diff).toBeGreaterThan(-1);
    expect(diff).toBeLessThan(question);
  }),
);
