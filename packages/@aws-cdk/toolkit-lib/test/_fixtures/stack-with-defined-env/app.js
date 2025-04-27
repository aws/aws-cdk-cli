import * as s3 from 'aws-cdk-lib/aws-s3';
import * as core from 'aws-cdk-lib/core';

const app = new core.App({ autoSynth: false });
const stack = new core.Stack(app, 'Stack1', {
  env: {
    account: '11111111111',
    region: 'us-east-1',
  },
});
new s3.Bucket(stack, 'MyBucket');
app.synth();
