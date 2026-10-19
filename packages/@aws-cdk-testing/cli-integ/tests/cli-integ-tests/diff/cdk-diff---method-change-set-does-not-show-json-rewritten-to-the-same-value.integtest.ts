import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

/**
 * Regression test for https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * The JSON is built with Fn::Sub instead of Fn::Join and resolves to the same value. The template
 * text differs, so the changeset-based diff must keep trusting CloudFormation that nothing changes.
 */
integTest(
  'cdk diff --method=change-set does not show JSON rewritten to the same value',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stackName = fixture.fullStackName('json-intrinsic');

    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - the same JSON is built with Fn::Sub
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { VARIANT: 'same-value-with-fn-sub' },
    });

    // THEN - nothing is shown
    expect(diff).toContain('There were no differences');
  }),
);
