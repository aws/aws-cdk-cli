import { integTest, withSpecificFixture } from '../../../lib';

/**
 * A replacement cannot be deployed with rollback disabled, so CDK stops before executing the change set.
 * Described with IncludePropertyValues, CloudFormation leaves the replacement of a task definition out
 * of the change set, and warns that it did (https://github.com/aws/aws-cdk-cli/issues/2036). The
 * description CDK checks before executing must still contain the replacement.
 */
integTest(
  'cdk deploy --no-rollback stops for a replacement CloudFormation drops with a warning',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    // GIVEN - a deployed task definition whose environment holds {"stack":"<stack name>","a":"1"}
    await fixture.cdkDeploy('json-intrinsic-replace');

    // WHEN - a key is added to the JSON and the deploy runs with rollback disabled. Without a terminal,
    // CDK cannot ask to deploy with rollback enabled instead, so it fails and nothing is replaced.
    const output = await fixture.cdkDeploy('json-intrinsic-replace', {
      options: ['--no-rollback'],
      modEnv: { JSON_CHANGE: 'add-key' },
      allowErrExit: true,
    });

    // THEN - CDK found the replacement and refused to deploy it with rollback disabled
    expect(output).toContain('Change includes a replacement which cannot be deployed while rollback is disabled');
  }),
);
