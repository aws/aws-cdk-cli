/// !cdk-integ test-stack

const cdk = require('aws-cdk-lib/core');
const lambda = require('aws-cdk-lib/aws-lambda');

const app = new cdk.App();
const stack = new cdk.Stack(app, 'test-stack');
new lambda.Function(stack, 'MyFunction1', {
  code: new lambda.InlineCode('foo'),
  handler: 'index.handler',
  runtime: lambda.Runtime.NODEJS_14_X,
});

app.synth();
