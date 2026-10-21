import { integTest, withSpecificFixture } from '../../../lib';

/**
 * A key is added to JSON built with an intrinsic in an SSM parameter, and the deploy asks for approval.
 *
 * - Start: `{"stack":"<stack name>","a":"1"}`
 * - End: `{"stack":"<stack name>","a":"1","b":"2"}`
 * - Command: `cdk deploy --require-approval=any-change --yes`
 * - Expected: the approval diff shows the parameter's `Value` as changed
 *
 * Described with IncludePropertyValues, CloudFormation leaves this change out of the change set,
 * without a warning (https://github.com/aws/aws-cdk-cli/issues/2036). The approval diff is built from
 * that change set.
 *
 * If CloudFormation stops leaving the change out, this test still passes; the unit tests are the
 * lasting coverage.
 */
integTest(
  'cdk deploy --require-approval any-change shows a key added to JSON built with an intrinsic',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - a key is added to the JSON, and the deploy asks for approval (auto-confirmed)
    const output = await fixture.cdkDeploy('json-intrinsic', {
      options: ['--require-approval=any-change', '--yes'],
      neverRequireApproval: false,
      modEnv: { JSON_CHANGE: 'add-key' },
    });

    // THEN - the approval diff shows the parameter value as changed
    expect(output).toContain('Do you wish to deploy these changes');
    expect(output).toMatch(/\[~\].*AWS::SSM::Parameter(?!::)/);
    expect(output).toMatch(/\[~\].*Value/);
  }),
);
