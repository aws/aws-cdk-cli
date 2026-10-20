import { integTest, withSpecificFixture } from '../../../lib';

/**
 * Guard for https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * The task definition replacement CloudFormation leaves out of a change set described with
 * IncludePropertyValues (with a warning) is destructive, so --require-approval destructive must ask.
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
      modEnv: { VARIANT: 'add-key' },
    });

    // THEN - the replacement is listed as destructive
    expect(output).toContain('Do you wish to deploy these changes');
    expect(output).toMatch(/AWS::ECS::TaskDefinition.*will be replaced/);
  }),
);
