import { integTest, withSpecificFixture } from '../../../lib';

/**
 * A key is added, a change set is created without executing it, and the change set is executed afterwards.
 *
 * - Start: `{"stack":"<stack name>","a":"1"}`
 * - End: `{"stack":"<stack name>","a":"1","b":"2"}`
 * - Command: `cdk deploy --no-execute --change-set-name=<name> --require-approval=any-change --yes`, then
 *   `cdk deploy --method=execute-change-set --change-set-name=<name>`
 * - Expected: the approval diff of the first command shows the parameter's `Value` as changed, and after
 *   executing the change set a template diff finds nothing left to change
 *
 * Described with IncludePropertyValues, CloudFormation leaves this change out of the change set,
 * without a warning (https://github.com/aws/aws-cdk-cli/issues/2036). `--no-execute` reads the same
 * change set, and executing it shows the deploy itself applies the key.
 *
 * If CloudFormation stops leaving the change out, this test still passes; the unit tests are the
 * lasting coverage.
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
