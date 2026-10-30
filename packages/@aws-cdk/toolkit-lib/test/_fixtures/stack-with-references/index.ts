import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as core from 'aws-cdk-lib/core';

export default async () => {
  const app = new core.App({
    autoSynth: false,
    // keep local paths out of the checked-in metadata
    context: { 'aws:cdk:disable-creation-stack-traces': true },
  });
  const stack = new core.Stack(app, 'Stack1', {
    env: {
      account: '123456789012',
      region: 'us-east-1',
    },
  });
  const bucket = new s3.Bucket(stack, 'MyBucket');
  // Ref to another resource
  new ssm.StringParameter(stack, 'BucketName', { stringValue: bucket.bucketName });
  // Fn::GetAtt the evaluator formats itself, one it has to look up, a pseudo parameter and a Fn::Join
  new core.CfnOutput(stack, 'BucketArn', { value: bucket.bucketArn });
  new core.CfnOutput(stack, 'BucketDomain', { value: bucket.bucketRegionalDomainName });
  new core.CfnOutput(stack, 'Name', { value: core.Aws.STACK_NAME });
  new core.CfnOutput(stack, 'Joined', { value: core.Fn.join('-', [bucket.bucketName, core.Aws.REGION]) });
  // A parameter, to test parameters that are NoEcho in the deployed stack only
  const secret = new core.CfnParameter(stack, 'Secret', { default: 'template-default' });
  new core.CfnOutput(stack, 'SecretValue', { value: secret.valueAsString });
  // A nested stack that gets the bucket name as a parameter
  const nested = new core.NestedStack(stack, 'Nested');
  new ssm.StringParameter(nested, 'NestedBucketName', { stringValue: bucket.bucketName });
  return app.synth();
};
