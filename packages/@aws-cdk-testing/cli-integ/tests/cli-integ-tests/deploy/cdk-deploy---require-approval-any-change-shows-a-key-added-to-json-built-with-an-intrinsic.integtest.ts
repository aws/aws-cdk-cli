import { integTest, withSpecificFixture } from '../../../lib';

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
