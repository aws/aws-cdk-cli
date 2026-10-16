import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

/**
 * Regression test for https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * When another property of the parameter changes too, CloudFormation keeps the parameter in a change
 * set described with IncludePropertyValues, but leaves out the value whose JSON gained a key, without
 * a warning. The changeset-based diff must show both changes.
 *
 * This only exercises the recovery for as long as CloudFormation keeps leaving the change out. If it
 * stops, the test still passes; the toolkit-lib unit tests are the lasting coverage.
 */
integTest(
  'cdk diff --method=change-set shows a key added to JSON built with an intrinsic when another property changes',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stackName = fixture.fullStackName('json-intrinsic');

    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}, described as "d1"
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - a key is added to the JSON, and the description changes
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { VARIANT: 'add-key-and-description' },
    });

    // THEN - both property changes are shown
    expect(diff).toMatch(/\[~\] Description/);
    expect(diff).toMatch(/\[~\] Value/);
  }),
);
