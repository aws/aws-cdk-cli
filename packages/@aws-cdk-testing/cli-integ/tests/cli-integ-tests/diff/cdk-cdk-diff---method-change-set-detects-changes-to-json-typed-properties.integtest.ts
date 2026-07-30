import { integTest, withSpecificFixture } from '../../../lib';
import { QBUSINESS_REGIONS } from '../../../lib/regions';

/**
 * Regression test for https://github.com/aws/aws-cdk-cli/issues/1780
 *
 * `AWS::QBusiness::DataSource.Configuration` is a JSON-typed (opaque blob) property. When a
 * change set is described with `IncludePropertyValues`, CloudFormation fails property
 * validation on it and silently drops the entire resource change from the response, which
 * made `cdk diff --method=change-set` report "There were no differences".
 *
 * This test deploys the data source, changes a regex pattern inside the JSON blob, and
 * asserts that the change-set diff detects the change. It lives in its own app because
 * QBusiness only exists in a few regions, and synthesizing it elsewhere produces
 * "resource type does not exist" validation warnings.
 */
integTest(
  'cdk diff --method=change-set detects changes to JSON-typed properties',
  withSpecificFixture('qbusiness-app', async (fixture) => {
    const stackName = fixture.fullStackName('qbusiness-datasource');

    // GIVEN - a deployed data source whose JSON-typed Configuration contains the original patterns
    await fixture.cdkDeploy('qbusiness-datasource', {
      modEnv: { WEB_CRAWLER_URL_PATTERN: 'https://docs\\.aws\\.amazon\\.com/cdk/.*\\.html$' },
    });

    // WHEN - only a value inside the JSON blob changes
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName], {
      modEnv: { WEB_CRAWLER_URL_PATTERN: 'https://docs\\.aws\\.amazon\\.com/cdk/NEW-.*\\.html$' },
    });

    // THEN - the change-set diff surfaces the change
    expect(diff).not.toContain('There were no differences');
    expect(diff).toContain('AWS::QBusiness::DataSource');
    expect(diff).toContain('Configuration');
  }, { aws: { regions: QBUSINESS_REGIONS } }),
);
