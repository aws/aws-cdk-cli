const cdk = require('aws-cdk-lib/core');
const s3 = require('aws-cdk-lib/aws-s3');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error('the STACK_NAME_PREFIX environment variable is required');
}

class IncorrectBucketNameStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    new s3.Bucket(this, 'Bucket', {
      bucketName: '&@%$*&@$%',
    });
  }
}

const app = new cdk.App();
new IncorrectBucketNameStack(app, `${stackPrefix}-incorrect-bucket-name`);

app.synth();
