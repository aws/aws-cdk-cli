import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

/**
 * Companion to the regression tests for https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * Changing an existing value in JSON that is built with an intrinsic is a change CloudFormation lists
 * even in a change set described with IncludePropertyValues. The changeset-based diff shows it with
 * or without the recovery for changes CloudFormation leaves out.
 */
integTest(
  'cdk diff --method=change-set shows a changed value in JSON built with an intrinsic',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stackName = fixture.fullStackName('json-intrinsic');

    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - an existing value in the JSON changes
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { JSON_CHANGE: 'change-value' },
    });

    // THEN - the parameter value is shown as changed
    expect(diff).not.toContain('There were no differences');
    expect(diff).toHaveNextLineMatching(/\[~\].*AWS::SSM::Parameter(?!::)/, /\[~\].*Value/);
  }),
);
