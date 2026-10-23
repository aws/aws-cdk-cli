import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

/**
 * The CLI diffs nested stacks from their templates, not their change sets, so it shows this change
 * even though CloudFormation leaves it out of the nested change set
 * (https://github.com/aws/aws-cdk-cli/issues/2036). It must keep showing it if the CLI starts reading
 * nested change sets.
 */
integTest(
  'cdk diff --method=change-set shows a key added to JSON in a nested stack',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stackName = fixture.fullStackName('json-intrinsic-nested');

    // GIVEN - a deployed nested parameter holding {"stack":"<nested stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic-nested');

    // WHEN - a key is added to the JSON
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { JSON_CHANGE: 'add-key' },
    });

    // THEN - the nested parameter value is shown as changed
    expect(diff).toHaveNextLineMatching(/\[~\].*AWS::SSM::Parameter(?!::)/, /\[~\].*Value/);
  }),
);
