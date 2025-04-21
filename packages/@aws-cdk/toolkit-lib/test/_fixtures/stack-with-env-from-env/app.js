import * as s3 from 'aws-cdk-lib/aws-s3';
import * as core from 'aws-cdk-lib/core';

const app = new core.App({ autoSynth: false });
const stack = new core.Stack(app, 'Stack1', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
new s3.Bucket(stack, 'MyBucket');
app.synth();
