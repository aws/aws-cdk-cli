import { integTest, withSpecificFixture } from '../../../lib';

/**
 * Guard for https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * A drift-aware change set (--revert-drift) keeps a key added to JSON built with an intrinsic, even when
 * described with IncludePropertyValues. The approval diff must show it.
 */
integTest(
  'cdk deploy --revert-drift shows a key added to JSON built with an intrinsic',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - a key is added, and a drift-aware deploy asks for approval (auto-confirmed)
    const output = await fixture.cdkDeploy('json-intrinsic', {
      options: ['--revert-drift', '--require-approval=any-change', '--yes'],
      neverRequireApproval: false,
      modEnv: { VARIANT: 'add-key' },
    });

    // THEN - the approval diff shows the parameter value as changed
    expect(output).toContain('Do you wish to deploy these changes');
    expect(output).toMatch(/\[~\].*AWS::SSM::Parameter(?!::)/);
    expect(output).toMatch(/\[~\].*Value/);
  }),
);
