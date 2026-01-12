const cdk = require('aws-cdk-lib');

const app = new cdk.App();

const contextValue = app.node.tryGetContext('myContextParam');

if (!contextValue) {
  throw new Error('Context parameter "myContextParam" is required');
}

const stack = new cdk.Stack(app, 'TestStack', {
  description: `Stack created with context value: ${contextValue}`,
});

// Add a simple resource
new cdk.CfnOutput(stack, 'ContextValue', {
  value: contextValue,
  description: 'The context value passed via CLI',
});

app.synth();
