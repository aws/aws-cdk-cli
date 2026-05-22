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
    this.version = '1.0.0';
  }

  validate(context) {
    const violations = [];
    for (const templatePath of context.templatePaths) {
      const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
      for (const [logicalId, resource] of Object.entries(template.Resources || {})) {
        if (resource.Type === 'AWS::S3::Bucket') {
          violations.push({
            ruleName: 'no-public-buckets',
            description: 'S3 Buckets must not be publicly accessible',
            fix: 'Set PublicAccessBlockConfiguration on the bucket',
            severity: 'error',
            violatingResources: [{
              resourceLogicalId: logicalId,
              templatePath,
              locations: [`/Resources/${logicalId}/Properties/PublicAccessBlockConfiguration`],
            }],
          });
        }
      }
    }
    return { success: violations.length === 0, violations };
  }
}

const app = new cdk.App();
cdk.Validations.of(app).addPlugins(new SecurityPlugin());

// Valid stack — no offline or online errors
class ValidStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    new cdk.CfnResource(this, 'WaitHandle', {
      type: 'AWS::CloudFormation::WaitConditionHandle',
    });
  }
}

// Invalid stack (online only) — CFN rejects the resource type
class OnlineInvalidStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    new cdk.CfnResource(this, 'BadResource', {
      type: 'AWS::Fake::DoesNotExist',
      properties: { SomeProperty: 'value' },
    });
  }
}

// Combined stack — has BOTH offline (S3 bucket triggers SecurityPlugin)
// AND online errors (invalid resource type rejected by CFN)
class CombinedStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    new s3.Bucket(this, 'MyBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new cdk.CfnResource(this, 'BadResource', {
      type: 'AWS::Fake::DoesNotExist',
      properties: { SomeProperty: 'value' },
    });
  }
}

new ValidStack(app, `${stackPrefix}-validate-online-valid`);
new OnlineInvalidStack(app, `${stackPrefix}-validate-online-invalid`);
new CombinedStack(app, `${stackPrefix}-validate-online-combined`);

app.synth();
