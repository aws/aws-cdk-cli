const cdk = require('aws-cdk-lib');
const { Stack } = require('aws-cdk-lib');
const s3 = require('aws-cdk-lib/aws-s3');
const sqs = require('aws-cdk-lib/aws-sqs');

const stackPrefix = process.env.STACK_NAME_PREFIX;
const app = new cdk.App();

// Create a stack with many resources to exceed 50KB template size
class LargeStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Create 450 S3 buckets to make the template large (>50KB)
    for (let i = 0; i < 450; i++) {
      new s3.Bucket(this, `Bucket${i}`, {
        bucketName: `large-template-bucket-${i}-${cdk.Stack.of(this).account}`,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        // Add tags to increase template size
        tags: {
          Environment: 'Test',
          Application: 'LargeTemplateTest',
          Owner: 'CDK-IntegTest',
          CostCenter: '12345',
          Index: `${i}`,
        },
      });
    }

    // Add a queue with configurable logical ID to test refactoring
    new sqs.Queue(this, process.env.QUEUE_LOGICAL_ID || 'Queue');
  }
}

new LargeStack(app, `${stackPrefix}-large-stack`);

app.synth();
