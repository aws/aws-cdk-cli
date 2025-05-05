import * as s3 from 'aws-cdk-lib/aws-s3';
import * as core from 'aws-cdk-lib/core';

const stackName = process.env.STACK_NAME;
if (!stackName) {
    throw new Error('$STACK_NAME not set!');
}

const app = new core.App({ autoSynth: false });
const stack = new core.Stack(app, stackName);
new s3.Bucket(stack, 'MyBucket');
app.synth();
