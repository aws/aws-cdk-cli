import * as s3 from 'aws-cdk-lib/aws-s3';
import * as core from 'aws-cdk-lib/core';

const app = new core.App({ autoSynth: false });
const stack = new core.Stack(app, 'Stack1', {
  env: {
    account: '123456789012',
    region: 'eu-west-1',
  },
});
new s3.Bucket(stack, 'MyBucket', {
  bucketName: core.ContextProvider.getValue(stack, {
    provider: 'plugin',
    props: {
      account: '123456789012',
      region: 'eu-west-1',
    },
  }).value,
});
app.synth();
