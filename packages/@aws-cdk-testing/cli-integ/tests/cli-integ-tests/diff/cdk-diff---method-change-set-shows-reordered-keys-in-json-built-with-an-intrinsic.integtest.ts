import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

/**
 * Regression test for https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * Reordering the keys changes the stored string, but CloudFormation leaves the change out of a change
 * set described with IncludePropertyValues, without a warning.
 */
integTest(
  'cdk diff --method=change-set shows reordered keys in JSON built with an intrinsic',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stackName = fixture.fullStackName('json-intrinsic');

    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - the keys of the JSON are reordered
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { VARIANT: 'reorder-keys' },
    });

    // THEN - the parameter value is shown as changed
    expect(diff).not.toContain('There were no differences');
    expect(diff).toHaveNextLineMatching(/\[~\].*AWS::SSM::Parameter(?!::)/, /\[~\].*Value/);
  }),
);
