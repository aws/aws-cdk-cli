import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

/**
 * An existing value changes in JSON built with an intrinsic in an SSM parameter.
 *
 * - Start: `{"stack":"<stack name>","a":"1"}`
 * - End: `{"stack":"<stack name>","a":"2"}`
 * - Command: `cdk diff --method=change-set`
 * - Expected: the parameter's `Value` is shown as changed
 *
 * CloudFormation lists this change even when described with IncludePropertyValues. It makes sure the
 * recovery for the changes it leaves out (https://github.com/aws/aws-cdk-cli/issues/2036) does not
 * affect the ones it lists.
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
