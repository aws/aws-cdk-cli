import * as cdk from 'aws-cdk-lib/core';

const app = new cdk.App({ autoSynth: false });
const stage = new cdk.Stage(app, 'Stage');
new cdk.Stack(stage, 'Stack1');

app.synth();
