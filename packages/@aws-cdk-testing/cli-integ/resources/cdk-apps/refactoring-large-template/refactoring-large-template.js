const cdk = require('aws-cdk-lib');
const { Stack } = require('aws-cdk-lib');
const s3 = require('aws-cdk-lib/aws-s3');
const sqs = require('aws-cdk-lib/aws-sqs');

const stackPrefix = process.env.STACK_NAME_PREFIX;
const app = new cdk.App();

// Create a stack with many resources to exceed 50KB template size (100 buckets = ~260KB)
class LargeStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    for (let i = 0; i < 100; i++) {
      new s3.Bucket(this, `Bucket${i}`, {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });
    }

    // Add a queue with configurable logical ID to test refactoring
    new sqs.Queue(this, process.env.QUEUE_LOGICAL_ID || 'Queue');
  }
}

new LargeStack(app, `${stackPrefix}-large-stack`);

app.synth();
