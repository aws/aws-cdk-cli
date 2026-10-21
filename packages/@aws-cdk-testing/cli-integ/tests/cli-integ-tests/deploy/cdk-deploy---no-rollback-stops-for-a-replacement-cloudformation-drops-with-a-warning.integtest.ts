import { integTest, withSpecificFixture } from '../../../lib';

/**
 * Guard for https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * A replacement cannot be deployed with rollback disabled. The task definition replacement
 * CloudFormation leaves out of a change set described with IncludePropertyValues (with a warning) must
 * still be found when the change set is executed.
 */
integTest(
  'cdk deploy --no-rollback stops for a replacement CloudFormation drops with a warning',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    // GIVEN - a deployed task definition whose environment holds {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic-replace');

    // WHEN - a key is added to the JSON and the deploy runs with rollback disabled (the offer to deploy
    // with rollback enabled is auto-confirmed)
    const output = await fixture.cdkDeploy('json-intrinsic-replace', {
      options: ['--no-rollback', '--yes'],
      modEnv: { JSON_CHANGE: 'add-key' },
    });

    // THEN - CDK refuses to replace with rollback disabled
    expect(output).toContain('Change includes a replacement which cannot be deployed while rollback is disabled');
  }),
);
