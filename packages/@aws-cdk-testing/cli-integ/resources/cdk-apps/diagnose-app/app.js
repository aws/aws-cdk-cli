const cdk = require('aws-cdk-lib');
const s3 = require('aws-cdk-lib/aws-s3');
const iam = require('aws-cdk-lib/aws-iam');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error('the STACK_NAME_PREFIX environment variable is required');
}

const app = new cdk.App({
  context: {
    '@aws-cdk/core:assetHashSalt': process.env.CODEBUILD_BUILD_ID ?? process.env.GITHUB_RUN_ID,
  },
});

const defaultEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

/**
 * A stack that will fail during deployment because it creates an IAM Policy
 * without the required PolicyDocument property.
 */
class DeployFailStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    new cdk.CfnResource(this, 'BadPolicy', {
      type: 'AWS::IAM::Policy',
      // Missing required PolicyDocument property — will fail during deployment
    });
  }
}

/**
 * Two stacks that create S3 buckets with the same name.
 * Deploying the first, then the second, triggers an early validation error.
 */
class EarlyValidationStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    new s3.Bucket(this, 'MyBucket', {
      bucketName: process.env.BUCKET_NAME,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}

/**
 * A stack with a named IAM role. Used for the auto-import failure test:
 * deploy with RETAIN, destroy, then re-deploy without RETAIN using --import-existing-resources.
 */
class ImportFailStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const retain = process.env.REMOVAL_POLICY === 'retain';

    const role = new iam.Role(this, 'MyRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: `${stackPrefix}-diagnose-import-role`,
    });
    role.applyRemovalPolicy(retain ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY);
  }
}

new DeployFailStack(app, `${stackPrefix}-diagnose-deploy-fail`, { env: defaultEnv });
new EarlyValidationStack(app, `${stackPrefix}-diagnose-early-val-1`, { env: defaultEnv });
new EarlyValidationStack(app, `${stackPrefix}-diagnose-early-val-2`, { env: defaultEnv });
new ImportFailStack(app, `${stackPrefix}-diagnose-import-fail`, { env: defaultEnv });

app.synth();
