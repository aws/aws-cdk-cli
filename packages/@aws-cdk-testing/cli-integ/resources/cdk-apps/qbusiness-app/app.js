const cdk = require('aws-cdk-lib/core');
const iam = require('aws-cdk-lib/aws-iam');
const qbusiness = require('aws-cdk-lib/aws-qbusiness');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error('the STACK_NAME_PREFIX environment variable is required');
}

// A QBusiness web crawler data source, whose `Configuration` is a JSON-typed (opaque blob)
// property. CloudFormation fails to render property values for it when a change set is described
// with IncludePropertyValues, and silently drops the resource change. Used to verify that
// `cdk diff --method=change-set` still detects changes inside the blob.
// See aws/aws-cdk-cli#1780.
class QBusinessDataSourceStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Anonymous identity type avoids the IAM Identity Center requirement.
    const application = new qbusiness.CfnApplication(this, 'Application', {
      displayName: `${id}-app`,
      identityType: 'ANONYMOUS',
    });

    const index = new qbusiness.CfnIndex(this, 'Index', {
      applicationId: application.attrApplicationId,
      displayName: `${id}-index`,
      type: 'STARTER',
      capacityConfiguration: { units: 1 },
    });

    const dataSourceRole = new iam.Role(this, 'DataSourceRole', {
      assumedBy: new iam.ServicePrincipal('qbusiness.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: {
            'aws:SourceArn': this.formatArn({
              service: 'qbusiness',
              resource: 'application',
              resourceName: '*',
            }),
          },
        },
      }),
      inlinePolicies: {
        DataSourceAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: 'AllowsAmazonQToIngestDocuments',
              actions: ['qbusiness:BatchPutDocument', 'qbusiness:BatchDeleteDocument'],
              resources: [
                index.attrIndexArn,
                `${application.attrApplicationArn}/index/${index.attrIndexId}/data-source/*`,
              ],
            }),
            new iam.PolicyStatement({
              sid: 'AllowsAmazonQToIngestPrincipalMapping',
              actions: [
                'qbusiness:PutGroup',
                'qbusiness:CreateUser',
                'qbusiness:DeleteGroup',
                'qbusiness:UpdateUser',
                'qbusiness:ListGroups',
              ],
              resources: [
                application.attrApplicationArn,
                index.attrIndexArn,
                `${application.attrApplicationArn}/index/${index.attrIndexId}/data-source/*`,
              ],
            }),
          ],
        }),
      },
    });

    // The test changes only these patterns, inside the JSON blob
    const patterns = [process.env.WEB_CRAWLER_URL_PATTERN || 'https://docs\\.aws\\.amazon\\.com/cdk/.*\\.html$'];

    new qbusiness.CfnDataSource(this, 'WebCrawlerDataSource', {
      applicationId: application.attrApplicationId,
      indexId: index.attrIndexId,
      displayName: `${id}-webcrawler`,
      roleArn: dataSourceRole.roleArn,
      configuration: {
        type: 'WEBCRAWLERV2',
        syncMode: 'FULL_CRAWL',
        connectionConfiguration: {
          repositoryEndpointMetadata: {
            seedUrlConnections: [{ seedUrl: 'https://docs.aws.amazon.com/cdk/' }],
            authentication: 'NoAuthentication',
          },
        },
        repositoryConfigurations: {
          webPage: {
            fieldMappings: [
              {
                indexFieldName: '_source_uri',
                indexFieldType: 'STRING',
                dataSourceFieldName: 'sourceUrl',
              },
            ],
          },
        },
        additionalProperties: {
          rateLimit: '300',
          maxFileSize: '50',
          crawlDepth: '1',
          maxLinksPerUrl: '10',
          crawlSubDomain: false,
          crawlAllDomain: false,
          honorRobots: true,
          crawlAttachments: false,
          inclusionURLCrawlPatterns: patterns,
          inclusionURLIndexPatterns: patterns,
        },
      },
    });
  }
}

const app = new cdk.App();
new QBusinessDataSourceStack(app, `${stackPrefix}-qbusiness-datasource`);

app.synth();
