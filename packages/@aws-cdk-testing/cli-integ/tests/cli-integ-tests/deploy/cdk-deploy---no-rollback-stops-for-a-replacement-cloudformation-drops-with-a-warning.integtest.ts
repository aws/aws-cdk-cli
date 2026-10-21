import { integTest, withSpecificFixture } from '../../../lib';

/**
 * A key is added to JSON in a container environment variable of an ECS task definition, which replaces it, and
 * the deploy runs with rollback disabled.
 *
 * - Start: `{"stack":"<stack name>","a":"1"}`
 * - End: `{"stack":"<stack name>","a":"1","b":"2"}`
 * - Command: `cdk deploy --no-rollback`
 * - Expected: CDK refuses to deploy the replacement with rollback disabled. Without a terminal it cannot offer
 *   to deploy with rollback enabled instead, so it fails and nothing is replaced
 *
 * Described with IncludePropertyValues, CloudFormation leaves the replacement out of the change set,
 * but warns that it did (https://github.com/aws/aws-cdk-cli/issues/2036). The check runs on the
 * description CDK makes before executing the change set, not the one the approval uses.
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
