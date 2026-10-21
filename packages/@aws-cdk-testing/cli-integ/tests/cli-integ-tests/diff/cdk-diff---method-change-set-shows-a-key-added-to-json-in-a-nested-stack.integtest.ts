import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

/**
 * A key is added to JSON built with an intrinsic in an SSM parameter in a nested stack.
 *
 * - Start: `{"stack":"<stack name>","a":"1"}`
 * - End: `{"stack":"<stack name>","a":"1","b":"2"}`
 * - Command: `cdk diff --method=change-set`
 * - Expected: the nested parameter's `Value` is shown as changed
 *
 * CloudFormation leaves this change out of the nested change set described with IncludePropertyValues
 * (https://github.com/aws/aws-cdk-cli/issues/2036). The CLI diffs nested stacks from their templates,
 * not their change sets, so it shows the change. If the CLI starts reading nested change sets, it must
 * keep showing it.
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
