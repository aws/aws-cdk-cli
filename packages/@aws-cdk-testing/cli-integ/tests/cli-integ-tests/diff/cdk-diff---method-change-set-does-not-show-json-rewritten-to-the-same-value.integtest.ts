import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

/**
 * JSON built with Fn::Join in an SSM parameter is rewritten with Fn::Sub, resolving to the same value.
 *
 * - Start: `{"stack":"<stack name>","a":"1"}`, built with Fn::Join
 * - End: `{"stack":"<stack name>","a":"1"}`, built with Fn::Sub
 * - Command: `cdk diff --method=change-set`
 * - Expected: "There were no differences"
 *
 * The template text differs, but nothing changes when it is deployed, and CloudFormation leaves it out
 * of the change set either way. The recovery for changes CloudFormation leaves out
 * (https://github.com/aws/aws-cdk-cli/issues/2036) must not show it.
 */
integTest(
  'cdk diff --method=change-set does not show JSON rewritten to the same value',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stackName = fixture.fullStackName('json-intrinsic');

    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - the same JSON is built with Fn::Sub
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { JSON_CHANGE: 'same-value-with-fn-sub' },
    });

    // THEN - nothing is shown
    expect(diff).toContain('There were no differences');
  }),
);
