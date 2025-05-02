import * as s3 from 'aws-cdk-lib/aws-s3';
import * as core from 'aws-cdk-lib/core';

export default async () => {
  const app = new core.App({ autoSynth: false });
  const stack = new core.Stack(app, 'Stack1');
  const bucket = new s3.Bucket(stack, 'MyBucket');
  bucket.node.defaultChild?.node.addMetadata('aws:cdk:do-not-refactor', true);
  return app.synth();
};
