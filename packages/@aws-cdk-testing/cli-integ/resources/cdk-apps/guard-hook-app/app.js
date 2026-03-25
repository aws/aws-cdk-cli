const cdk = require('aws-cdk-lib/core');
const s3 = require('aws-cdk-lib/aws-s3');
const iam = require('aws-cdk-lib/aws-iam');
const s3deploy = require('aws-cdk-lib/aws-s3-deployment');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error('the STACK_NAME_PREFIX environment variable is required');
}

const guardRuleKey = 'rules/AWS_S3_Bucket_AccessControl.guard';

const guardRuleContent = `rule AWS_S3_Bucket_AccessControl
{
    let resources = Resources.*[ Type == "AWS::S3::Bucket" ]
    %resources[*] {
        Properties.AccessControl not exists
        <<
            AccessControl is deprecated
        >>
    }
}`;

// Setup Guard Hook that will evaluate and fail the test stack
class GuardHookSetupStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // S3 bucket for Guard rules
    const rulesBucket = new s3.Bucket(this, 'RulesBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // S3 bucket for Guard logs
    const logsBucket = new s3.Bucket(this, 'LogsBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Grant CDK deploy role read access to the logs bucket.
    // The bootstrap deploy role only has cross-account S3 permissions; same-account
    // access is granted by bucket policies, per the bootstrap template's design intent.
    const deployRoleArn = cdk.Fn.sub(this.synthesizer.deployRoleArn);
    logsBucket.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ArnPrincipal(deployRoleArn)],
      actions: ['s3:GetObject', 's3:GetObjectVersion'],
      resources: [logsBucket.arnForObjects('*')],
    }));

    // Upload Guard rule to rules bucket
    new s3deploy.BucketDeployment(this, 'UploadGuardRule', {
      sources: [s3deploy.Source.data(guardRuleKey, guardRuleContent)],
      destinationBucket: rulesBucket,
    });

    // IAM role for Guard Hook execution
    const hookRole = new iam.Role(this, 'GuardHookExecutionRole', {
      assumedBy: new iam.ServicePrincipal('hooks.cloudformation.amazonaws.com'),
    });
    hookRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:ListBucket', 's3:GetObject', 's3:GetObjectVersion'],
      resources: [rulesBucket.bucketArn, rulesBucket.arnForObjects('*')],
    }));
    hookRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [logsBucket.arnForObjects('*')],
    }));

    // Guard Hook - activates and configures the AWS Guard Hook in this account/region
    new cdk.CfnGuardHook(this, 'GuardHook', {
      alias: 'Private::Guard::TestHook',
      executionRole: hookRole.roleArn,
      failureMode: 'FAIL',
      hookStatus: 'ENABLED',
      ruleLocation: {
        uri: `s3://${rulesBucket.bucketName}/${guardRuleKey}`,
      },
      logBucket: logsBucket.bucketName,
      targetOperations: ['RESOURCE'],
    });
  }
}

class GuardHookTestStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // This bucket violates the Guard rule by using the deprecated AccessControl property
    new s3.CfnBucket(this, 'NonCompliantBucket', {
      accessControl: 'Private',
    });
  }
}

const app = new cdk.App();
new GuardHookSetupStack(app, `${stackPrefix}-guard-hook-setup`);
new GuardHookTestStack(app, `${stackPrefix}-guard-hook-test`);

app.synth();
