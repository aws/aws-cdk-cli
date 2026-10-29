import { integTest, withSpecificFixture } from '../../../lib';

/**
 * Regression test for https://github.com/aws/aws-cdk-cli/issues/1922
 *
 * CloudFormation changesets do not detect exchanging one empty-object union member for
 * another (e.g. a WAFv2 action `{"Allow":{}}` -> `{"Block":{}}`) and report no changes.
 * The changeset-based diff must not let that hide the template-detected change.
 */
integTest(
  'cdk diff --method=change-set shows static changes the changeset fails to detect',
  withSpecificFixture('waf-app', async (fixture) => {
    const stackName = fixture.fullStackName('waf-web-acl');

    // GIVEN - a deployed WebACL with an Allow default action
    await fixture.cdkDeploy('waf-web-acl', {
      modEnv: { WAF_ACTION: 'Allow' },
    });

    // WHEN - the action changes to Block, a change CloudFormation's changeset does not report
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { WAF_ACTION: 'Block' },
    });

    // THEN - the template-detected change is surfaced anyway
    expect(diff).not.toContain('There were no differences');
    expect(diff).toContain('AWS::WAFv2::WebACL');
    expect(diff).toContain('DefaultAction');
  }),
);
