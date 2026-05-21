const cdk = require('aws-cdk-lib/core');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error('the STACK_NAME_PREFIX environment variable is required');
}

class ValidStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    new cdk.CfnResource(this, 'WaitHandle', {
      type: 'AWS::CloudFormation::WaitConditionHandle',
    });
  }
}

class InvalidStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    new cdk.CfnResource(this, 'BadResource', {
      type: 'AWS::Fake::DoesNotExist',
      properties: {
        SomeProperty: 'value',
      },
    });
  }
}

const app = new cdk.App();
new ValidStack(app, `${stackPrefix}-validate-online-valid`);
new InvalidStack(app, `${stackPrefix}-validate-online-invalid`);

app.synth();
