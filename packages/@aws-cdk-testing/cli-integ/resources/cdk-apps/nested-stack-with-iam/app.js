const { Stack, App } = require('aws-cdk-lib/core');
const { NestedStack } = require('aws-cdk-lib/aws-cloudformation');
const iam = require('aws-cdk-lib/aws-iam');
const sns = require('aws-cdk-lib/aws-sns');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error('the STACK_NAME_PREFIX environment variable is required');
}

class IamNestedStack extends NestedStack {
  constructor(scope, id) {
    super(scope, id);
    new iam.Role(this, 'NestedRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
  }
}

class NoSecurityNestedStack extends NestedStack {
  constructor(scope, id) {
    super(scope, id);
    new sns.Topic(this, 'Topic');
  }
}

class ParentStack extends Stack {
  constructor(scope, id) {
    super(scope, id);
    new IamNestedStack(this, 'IamNested');
    new NoSecurityNestedStack(this, 'NoSecurityNested');
    new IamNestedStack(this, 'AnotherIamNested');
  }
}

const app = new App();
new ParentStack(app, `${stackPrefix}-nested-iam`);
app.synth();
