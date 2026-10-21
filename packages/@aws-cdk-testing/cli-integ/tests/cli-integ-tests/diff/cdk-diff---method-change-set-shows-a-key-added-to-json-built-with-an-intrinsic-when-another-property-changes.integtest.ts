import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

/**
 * A key is added to JSON built with an intrinsic in an SSM parameter, while its description also changes.
 *
 * - Start: `{"stack":"<stack name>","a":"1"}`, description `d1`
 * - End: `{"stack":"<stack name>","a":"1","b":"2"}`, description `d2`
 * - Command: `cdk diff --method=change-set`
 * - Expected: both the parameter's `Description` and its `Value` are shown as changed
 *
 * Described with IncludePropertyValues, CloudFormation keeps the parameter in the change set for the
 * description, but leaves out its `Value`, without a warning
 * (https://github.com/aws/aws-cdk-cli/issues/2036).
 *
 * If CloudFormation stops leaving the change out, this test still passes; the unit tests are the
 * lasting coverage.
 */
integTest(
  'cdk diff --method=change-set shows a key added to JSON built with an intrinsic when another property changes',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stackName = fixture.fullStackName('json-intrinsic');

    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}, described as "d1"
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - a key is added to the JSON, and the description changes
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { JSON_CHANGE: 'add-key', DESCRIPTION: 'd2' },
    });

    // THEN - both property changes are shown
    expect(diff).toMatch(/\[~\] Description/);
    expect(diff).toMatch(/\[~\] Value/);
  }),
);
