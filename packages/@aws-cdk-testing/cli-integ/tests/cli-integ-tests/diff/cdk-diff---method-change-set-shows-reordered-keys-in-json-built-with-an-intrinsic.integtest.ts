import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

integTest(
  'cdk diff --method=change-set shows reordered keys in JSON built with an intrinsic',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stackName = fixture.fullStackName('json-intrinsic');

    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic');

    // WHEN - the keys of the JSON are reordered
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { JSON_CHANGE: 'reorder-keys' },
    });

    // THEN - the parameter value is shown as changed
    expect(diff).not.toContain('There were no differences');
    expect(diff).toHaveNextLineMatching(/\[~\].*AWS::SSM::Parameter(?!::)/, /\[~\].*Value/);
  }),
);
