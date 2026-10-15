import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

/**
 * Regression test for https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * Adding a key to JSON that is built with an intrinsic and stored in a string property is a change
 * CloudFormation leaves out of a change set described with IncludePropertyValues, without a warning.
 * The changeset-based diff must show it anyway.
 *
 * This only exercises the recovery for as long as CloudFormation keeps leaving the change out. If it
 * stops, the test still passes; the toolkit-lib unit tests are the lasting coverage.
 */
integTest(
  'cdk diff --method=change-set shows changes to JSON built with an intrinsic',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stackName = fixture.fullStackName('json-intrinsic');

    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - a key is added to the JSON
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { VARIANT: 'add-key' },
    });

    // THEN - the parameter value is shown as changed
    expect(diff).not.toContain('There were no differences');
    expect(diff).toHaveNextLineMatching(/\[~\].*AWS::SSM::Parameter(?!::)/, /\[~\].*Value/);
  }),
);
