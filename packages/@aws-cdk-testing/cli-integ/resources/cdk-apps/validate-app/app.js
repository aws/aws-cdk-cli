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

const app = new cdk.App();
cdk.Validations.of(app).addPlugins(shouldFail ? new SecurityPlugin() : new AlwaysPassesPlugin());

class ValidateStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    new s3.Bucket(this, 'MyBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}

new ValidateStack(app, `${stackPrefix}-validate`);

app.synth();
