import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

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
