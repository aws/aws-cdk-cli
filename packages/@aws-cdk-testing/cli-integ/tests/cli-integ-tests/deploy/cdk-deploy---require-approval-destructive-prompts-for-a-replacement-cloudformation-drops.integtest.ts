import { integTest, withSpecificFixture } from '../../../lib';

/**
 * A key is added to JSON in a container environment variable of an ECS task definition, which replaces it.
 *
 * - Start: `{"stack":"<stack name>","a":"1"}`
 * - End: `{"stack":"<stack name>","a":"1","b":"2"}`
 * - Command: `cdk deploy --require-approval=destructive --yes`
 * - Expected: the deploy asks for approval and lists the task definition as replaced
 *
 * Described with IncludePropertyValues, CloudFormation leaves the replacement out of the change set,
 * but warns that it did (https://github.com/aws/aws-cdk-cli/issues/2036). CDK then describes the
 * change set again, so the replacement is found.
 */
integTest(
  'cdk deploy --require-approval destructive prompts for a replacement CloudFormation drops',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    // GIVEN - a deployed task definition whose environment holds {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic-replace');

    // WHEN - a key is added to the JSON, and the deploy asks for approval of destructive changes (auto-confirmed)
    const output = await fixture.cdkDeploy('json-intrinsic-replace', {
      options: ['--require-approval=destructive', '--yes'],
      neverRequireApproval: false,
      modEnv: { JSON_CHANGE: 'add-key' },
    });

    // THEN - the replacement is listed as destructive
    expect(output).toContain('Do you wish to deploy these changes');
    expect(output).toMatch(/AWS::ECS::TaskDefinition.*will be replaced/);
  }),
);
