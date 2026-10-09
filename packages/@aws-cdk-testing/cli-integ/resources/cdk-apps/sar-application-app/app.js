const cdk = require('aws-cdk-lib/core');
const sam = require('aws-cdk-lib/aws-sam');
const secretsmanager = require('aws-cdk-lib/aws-secretsmanager');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

/**
 * A stack with an AWS::Serverless::Application, which CloudFormation resolves into an
 * AWS::CloudFormation::Stack with a pre-signed TemplateURL that is regenerated on every change set.
 *
 * Uses the same Serverless Application Repository application as `SecretRotation`, without the VPC.
 */
class SarApplicationStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const application = secretsmanager.SecretRotationApplication.MYSQL_ROTATION_SINGLE_USER;
    new sam.CfnApplication(this, 'Application', {
      location: {
        applicationId: application.applicationArnForPartition('aws'),
        semanticVersion: application.semanticVersionForPartition('aws'),
      },
      parameters: {
        endpoint: `https://secretsmanager.${this.region}.${this.urlSuffix}`,
        functionName: cdk.Names.uniqueResourceName(this, { maxLength: 64 }),
      },
    });
  }
}

const app = new cdk.App();
new SarApplicationStack(app, `${stackPrefix}-sar-application`);

app.synth();
