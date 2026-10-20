import { integTest, withSpecificFixture } from '../../../lib';

/**
 * Regression test for the deploy side of https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * A change set created with --no-execute and --require-approval asks for approval with a diff. Adding a
 * key to JSON built with an intrinsic is left out of the change set described with IncludePropertyValues,
 * without a warning; the diff must show it anyway. Executing the change set afterwards applies the key.
 */
integTest(
  'cdk deploy --no-execute shows a key added to JSON built with an intrinsic, then executes it',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stackName = fixture.fullStackName('json-intrinsic');
    const changeSetName = 'json-intrinsic-add-key';

    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - a key is added, and a change set is created without executing it (approval auto-confirmed)
    const prepare = await fixture.cdkDeploy('json-intrinsic', {
      options: ['--no-execute', `--change-set-name=${changeSetName}`, '--require-approval=any-change', '--yes'],
      neverRequireApproval: false,
      modEnv: { VARIANT: 'add-key' },
    });

    // THEN - the approval diff shows the parameter value as changed
    expect(prepare).toMatch(/\[~\].*AWS::SSM::Parameter(?!::)/);
    expect(prepare).toMatch(/\[~\].*Value/);

    // WHEN - the change set is executed
    await fixture.cdkDeploy('json-intrinsic', {
      options: ['--method=execute-change-set', `--change-set-name=${changeSetName}`],
      modEnv: { VARIANT: 'add-key' },
    });

    // THEN - the deployed template has the key: a template diff finds nothing left to change
    const diff = await fixture.cdk(['diff', '--method=template', stackName], { modEnv: { VARIANT: 'add-key' } });
    expect(diff).toContain('There were no differences');
  }),
);
