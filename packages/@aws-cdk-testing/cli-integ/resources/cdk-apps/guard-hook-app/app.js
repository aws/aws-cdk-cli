const cdk = require('aws-cdk-lib');
const s3 = require('aws-cdk-lib/aws-s3');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error('the STACK_NAME_PREFIX environment variable is required');
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
new GuardHookTestStack(app, `${stackPrefix}-guard-hook-test`);

app.synth();
