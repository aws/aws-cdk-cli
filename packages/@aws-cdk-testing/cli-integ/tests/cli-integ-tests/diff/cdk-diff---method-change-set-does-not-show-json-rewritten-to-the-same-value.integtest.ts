import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

/**
 * The template text changes but the deployed value does not, so CloudFormation leaves it out of the
 * change set.
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
