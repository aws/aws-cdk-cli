import { integTest, withSpecificFixture } from '../../../lib';

/**
 * Regression test for the deploy side of https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * Adding a key to JSON that is built with an intrinsic and stored in a string property is a change
 * CloudFormation leaves out of a change set described with IncludePropertyValues, without a warning.
 * The diff shown for --require-approval must show it anyway.
 *
 * This only exercises the recovery for as long as CloudFormation keeps leaving the change out. If it
 * stops, the test still passes; the toolkit-lib unit tests are the lasting coverage.
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
      modEnv: { VARIANT: 'add-key' },
    });

    // THEN - the approval diff shows the parameter value as changed
    expect(output).toContain('Do you wish to deploy these changes');
    expect(output).toMatch(/\[~\].*AWS::SSM::Parameter(?!::)/);
    expect(output).toMatch(/\[~\].*Value/);
  }),
);
