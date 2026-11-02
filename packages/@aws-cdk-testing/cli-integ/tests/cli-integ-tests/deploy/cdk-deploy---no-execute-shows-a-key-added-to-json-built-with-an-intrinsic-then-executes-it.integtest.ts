import { integTest, withSpecificFixture } from '../../../lib';

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
      modEnv: { JSON_CHANGE: 'add-key' },
    });

    // THEN - the approval diff shows the parameter value as changed
    expect(prepare).toMatch(/\[~\].*AWS::SSM::Parameter(?!::)/);
    expect(prepare).toMatch(/\[~\].*Value/);

    // WHEN - the change set is executed
    await fixture.cdkDeploy('json-intrinsic', {
      options: ['--method=execute-change-set', `--change-set-name=${changeSetName}`],
      modEnv: { JSON_CHANGE: 'add-key' },
    });

    // THEN - the deployed template has the key: a template diff finds nothing left to change
    const diff = await fixture.cdk(['diff', '--method=template', stackName], { modEnv: { JSON_CHANGE: 'add-key' } });
    expect(diff).toContain('There were no differences');
  }),
);
