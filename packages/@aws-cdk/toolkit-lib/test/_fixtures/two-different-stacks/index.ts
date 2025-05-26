import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as core from 'aws-cdk-lib/core';

export default async () => {
  const app = new core.App({ autoSynth: false });
  const stack1 = new core.Stack(app, 'Stack1');
  new s3.Bucket(stack1, 'MyBucket');
  const stack2 = new core.Stack(app, 'Stack2');
  new sqs.Queue(stack2, 'MyQueue');

  return app.synth();
};
