const cdk = require('aws-cdk-lib');
const s3 = require('aws-cdk-lib/aws-s3');

const BUCKET_ID = process.env.BUCKET_ID ?? 'OldName';
const stackPrefix = process.env.STACK_NAME_PREFIX;

const app = new cdk.App();

let gamma = {
  region: 'eu-central-1',
};
let prod = {
  region: 'us-east-1',
};

class MyStack extends cdk.Stack {
  constructor(scope, id) {
    super(scope, id);
    new s3.Bucket(this, BUCKET_ID);
  }
}

new MyStack(app, `${stackPrefix}-gamma-stack`, { env: gamma });
new MyStack(app, `${stackPrefix}-prod-stack`, { env: prod });

app.synth();