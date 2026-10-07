import { integTest, withSpecificFixture } from '../../../lib';

/**
 * Regression test for https://github.com/aws/aws-cdk-cli/issues/2025
 *
 * CloudFormation resolves an AWS::Serverless::Application into an AWS::CloudFormation::Stack whose
 * TemplateURL is a pre-signed URL that the Serverless Application Repository regenerates on every
 * change set. A change-set diff of an unchanged stack must not report that URL as a change.
 */
integTest(
  'cdk diff --method=change-set does not show a TemplateURL change for an unchanged AWS::Serverless::Application',
  withSpecificFixture('sar-application-app', async (fixture) => {
    const stackName = fixture.fullStackName('sar-application');

    // GIVEN
    await fixture.cdkDeploy('sar-application');

    // WHEN - diff the unchanged app using a change set
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName]);

    // THEN
    expect(diff).not.toContain('TemplateURL');
    expect(diff).toContain('There were no differences');
  }),
);
