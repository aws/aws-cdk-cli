import * as s3 from 'aws-cdk-lib/aws-s3';
import * as core from 'aws-cdk-lib/core';

export default async () => {
  const app = new core.App({ autoSynth: false });
  const stack1 = new core.Stack(app, 'Stack1', {
    env: {
      account: '123456789012',
      region: 'us-east-1',
    },
  });
  new s3.Bucket(stack1, 'NewBucketNameInStack1');

  const stack2 = new core.Stack(app, 'Stack2', {
    env: {
      account: '123456789012',
      region: 'us-east-2',
    },
  });
  new s3.Bucket(stack2, 'NewBucketNameInStack2');
  return app.synth();
};
