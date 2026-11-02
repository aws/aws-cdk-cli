const fs = require('fs');
const cdk = require('aws-cdk-lib/core');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

class BaseStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    new cdk.CfnWaitConditionHandle(this, 'Handle');
  }
}

const app = new cdk.App();
new BaseStack(app, `${stackPrefix}-test-1`);
app.synth();

if (process.env.CDK_PERF_COUNTERS_FILE) {
  fs.writeFileSync(process.env.CDK_PERF_COUNTERS_FILE, JSON.stringify({
    counters: {
      ExampleCounter: 42,
    },
  }, undefined, 2), 'utf-8');
}

