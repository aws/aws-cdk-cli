const cdk = require('aws-cdk-lib');
const sqs = require('aws-cdk-lib/aws-sqs');
const lambda = require('aws-cdk-lib/aws-lambda');
const s3 = require('aws-cdk-lib/aws-s3');

const stackPrefix = process.env.STACK_NAME_PREFIX;
const app = new cdk.App();

const stack  = new cdk.Stack(app, `${stackPrefix}-basic`);
new sqs.Queue(stack, process.env.BASIC_QUEUE_LOGICAL_ID ?? 'BasicQueue');

if (process.env.ADDITIONAL_QUEUE_LOGICAL_ID) {
  new sqs.Queue(stack, process.env.ADDITIONAL_QUEUE_LOGICAL_ID);
}

// This part is to test moving a resource to a separate stack
const bucketStack = process.env.BUCKET_IN_SEPARATE_STACK ? new cdk.Stack(app, `${stackPrefix}-bucket-stack`) : stack;
const bucket = new s3.Bucket(bucketStack, 'Bucket');

new lambda.Function(stack, 'Func', {
  runtime: lambda.Runtime.NODEJS_22_X,
  code: lambda.Code.fromInline(`exports.handler = handler.toString()`),
  handler: 'index.handler',
  environment: {
    BUCKET: bucket.bucketName
  }
});



app.synth();