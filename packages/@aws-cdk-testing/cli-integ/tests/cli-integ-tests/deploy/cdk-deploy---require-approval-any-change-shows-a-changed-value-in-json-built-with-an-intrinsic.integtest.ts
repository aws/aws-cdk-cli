import { integTest, withSpecificFixture } from '../../../lib';

/**
 * Companion to the deploy regression test for https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * Changing an existing value in JSON built with an intrinsic is a change CloudFormation lists even in a
 * change set described with IncludePropertyValues. The approval diff shows it with or without the
 * recovery for changes CloudFormation leaves out.
 */
integTest(
  'cdk deploy --require-approval any-change shows a changed value in JSON built with an intrinsic',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - an existing value changes, and the deploy asks for approval (auto-confirmed)
    const output = await fixture.cdkDeploy('json-intrinsic', {
      options: ['--require-approval=any-change', '--yes'],
      neverRequireApproval: false,
      modEnv: { VARIANT: 'change-value' },
    });

    // THEN - the approval diff shows the parameter value as changed
    expect(output).toContain('Do you wish to deploy these changes');
    expect(output).toMatch(/\[~\].*AWS::SSM::Parameter(?!::)/);
    expect(output).toMatch(/\[~\].*Value/);
  }),
);
