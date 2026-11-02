const fs = require('fs');
const cdk = require('aws-cdk-lib/core');
const s3 = require('aws-cdk-lib/aws-s3');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error('the STACK_NAME_PREFIX environment variable is required');
}

class SecurityPlugin {
  constructor() {
    this.name = 'SecurityPlugin';
    this.version = '2.1.0';
  }

  validate(context) {
    const violations = [];
    for (const templatePath of context.templatePaths) {
      const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
      for (const [logicalId, resource] of Object.entries(template.Resources || {})) {
        if (resource.Type === 'AWS::S3::Bucket') {
          violations.push(
            {
              ruleName: 'no-public-buckets',
              description: 'S3 Buckets must not be publicly accessible',
              fix: 'Set PublicAccessBlockConfiguration on the bucket',
              severity: 'fatal',
              violatingResources: [{
                resourceLogicalId: logicalId,
                templatePath,
                locations: [`/Resources/${logicalId}/Properties/PublicAccessBlockConfiguration`],
              }],
            },
            {
              ruleName: 'require-encryption',
              description: 'S3 Buckets must have server-side encryption enabled',
              fix: 'Add BucketEncryption property with SSE-S3 or SSE-KMS',
              severity: 'error',
              violatingResources: [{
                resourceLogicalId: logicalId,
                templatePath,
                locations: [`/Resources/${logicalId}/Properties/BucketEncryption`],
              }],
            },
            {
              ruleName: 'require-versioning',
              description: 'S3 Buckets should have versioning enabled for data protection',
              severity: 'warning',
              violatingResources: [{
                resourceLogicalId: logicalId,
                templatePath,
                locations: [`/Resources/${logicalId}/Properties/VersioningConfiguration`],
              }],
            },
            {
              ruleName: 'consider-intelligent-tiering',
              description: 'Consider using Intelligent-Tiering storage class for cost optimization',
              severity: 'cost-optimization',
              violatingResources: [{
                resourceLogicalId: logicalId,
                templatePath,
                locations: [`/Resources/${logicalId}/Properties/IntelligentTieringConfigurations`],
              }],
            },
          );
        }
      }
    }

    return {
      success: violations.length === 0,
      violations,
    };
  }
}

const app = new cdk.App();
cdk.Validations.of(app).addPlugins(new SecurityPlugin());

class ValidateStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const bucket = new s3.Bucket(this, 'MyBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Construct Annotations plugin picks this up
    cdk.Annotations.of(bucket).addWarningV2('bucket-no-lifecycle', 'This bucket has no lifecycle rules configured');
  }
}

new ValidateStack(app, `${stackPrefix}-validate`);

app.synth();
