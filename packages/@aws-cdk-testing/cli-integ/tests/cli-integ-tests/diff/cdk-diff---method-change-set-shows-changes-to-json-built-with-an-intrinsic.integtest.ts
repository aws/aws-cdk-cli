import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

/**
 * A key is added to JSON built with an intrinsic in an SSM parameter.
 *
 * - Start: `{"stack":"<stack name>","a":"1"}`
 * - End: `{"stack":"<stack name>","a":"1","b":"2"}`
 * - Command: `cdk diff --method=change-set`
 * - Expected: the parameter's `Value` is shown as changed
 *
 * Described with IncludePropertyValues, CloudFormation leaves this change out of the change set,
 * without a warning (https://github.com/aws/aws-cdk-cli/issues/2036).
 *
 * If CloudFormation stops leaving the change out, this test still passes; the unit tests are the
 * lasting coverage.
 */
integTest(
  'cdk diff --method=change-set shows changes to JSON built with an intrinsic',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stackName = fixture.fullStackName('json-intrinsic');

    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - a key is added to the JSON
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { JSON_CHANGE: 'add-key' },
    });

    // THEN - the parameter value is shown as changed
    expect(diff).not.toContain('There were no differences');
    expect(diff).toHaveNextLineMatching(/\[~\].*AWS::SSM::Parameter(?!::)/, /\[~\].*Value/);
  }),
);
