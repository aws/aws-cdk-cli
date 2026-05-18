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
    return {
      success: false,
      violations: [
        {
          ruleName: 'no-public-buckets',
          description: 'S3 Buckets must not be publicly accessible',
          fix: 'Set PublicAccessBlockConfiguration on the bucket',
          severity: 'fatal',
          violatingResources: context.templatePaths.map(templatePath => ({
            resourceLogicalId: 'MyBucket',
            templatePath,
            locations: ['/Resources/MyBucket/Properties/PublicAccessBlockConfiguration'],
          })),
        },
        {
          ruleName: 'require-encryption',
          description: 'S3 Buckets must have server-side encryption enabled',
          fix: 'Add BucketEncryption property with SSE-S3 or SSE-KMS',
          severity: 'error',
          violatingResources: context.templatePaths.map(templatePath => ({
            resourceLogicalId: 'MyBucket',
            templatePath,
            locations: ['/Resources/MyBucket/Properties/BucketEncryption'],
          })),
        },
        {
          ruleName: 'require-versioning',
          description: 'S3 Buckets should have versioning enabled for data protection',
          severity: 'warning',
          violatingResources: context.templatePaths.map(templatePath => ({
            resourceLogicalId: 'MyBucket',
            templatePath,
            locations: ['/Resources/MyBucket/Properties/VersioningConfiguration'],
          })),
        },
        {
          ruleName: 'consider-intelligent-tiering',
          description: 'Consider using Intelligent-Tiering storage class for cost optimization',
          severity: 'info',
          violatingResources: context.templatePaths.map(templatePath => ({
            resourceLogicalId: 'MyBucket',
            templatePath,
            locations: ['/Resources/MyBucket/Properties/IntelligentTieringConfigurations'],
          })),
        },
        {
          ruleName: 'org-tagging-policy',
          description: 'Resource does not comply with organization tagging policy TG-0042',
          severity: 'compliance',
          violatingResources: context.templatePaths.map(templatePath => ({
            resourceLogicalId: 'MyBucket',
            templatePath,
            locations: ['/Resources/MyBucket/Properties/Tags'],
          })),
        },
      ],
    };
  }
}

class AlwaysPassesPlugin {
  constructor() {
    this.name = 'AlwaysPassesPlugin';
    this.version = '1.0.0';
  }

  validate(_context) {
    return {
      success: true,
      violations: [],
    };
  }
}

const shouldFail = process.env.VALIDATION_SHOULD_FAIL === 'true';
const shouldAcknowledge = process.env.VALIDATION_ACKNOWLEDGE === 'true';

const app = new cdk.App();
cdk.Validations.of(app).addPlugins(shouldFail ? new SecurityPlugin() : new AlwaysPassesPlugin());

class ValidateStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const bucket = new s3.Bucket(this, 'MyBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Construct Annotations plugin will pick up this warning
    cdk.Validations.of(bucket).addWarning('bucket-no-lifecycle', 'This bucket has no lifecycle rules configured');

    if (shouldAcknowledge) {
      cdk.Validations.of(bucket).acknowledge({ id: 'bucket-no-lifecycle', reason: 'Lifecycle rules not needed for this use case' });
    }
  }
}

new ValidateStack(app, `${stackPrefix}-validate`);

app.synth();
