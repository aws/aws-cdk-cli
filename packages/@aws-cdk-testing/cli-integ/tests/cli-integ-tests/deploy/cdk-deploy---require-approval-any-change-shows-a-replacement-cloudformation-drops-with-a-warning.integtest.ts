import { integTest, withSpecificFixture } from '../../../lib';

/**
 * Guard for https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * Adding a key to JSON in a container environment variable replaces the task definition. Described with
 * IncludePropertyValues, CloudFormation leaves the replacement out but warns that the change set is
 * incomplete, and the CLI describes it again without property values. The approval diff must show the
 * replacement.
 */
integTest(
  'cdk deploy --require-approval any-change shows a replacement CloudFormation drops with a warning',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    // GIVEN - a deployed task definition whose environment holds {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic-replace');

    // WHEN - a key is added to the JSON, and the deploy asks for approval (auto-confirmed)
    const output = await fixture.cdkDeploy('json-intrinsic-replace', {
      options: ['--require-approval=any-change', '--yes'],
      neverRequireApproval: false,
      modEnv: { JSON_CHANGE: 'add-key' },
    });

    // THEN - the approval diff shows the task definition being replaced
    expect(output).toContain('Do you wish to deploy these changes');
    expect(output).toMatch(/\[~\].*AWS::ECS::TaskDefinition.*replace/);
  }),
);
