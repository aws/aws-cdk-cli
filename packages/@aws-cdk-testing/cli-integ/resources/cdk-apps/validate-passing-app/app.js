const cdk = require('aws-cdk-lib/core');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error('the STACK_NAME_PREFIX environment variable is required');
}

class AlwaysPassesPlugin {
  constructor() {
    this.name = 'AlwaysPassesPlugin';
    this.version = '1.0.0';
  }

  validate(_context) {
    return {
      success: true,
      violations: [],
    };
  }
}

const app = new cdk.App();
cdk.Validations.of(app).addPlugins(new AlwaysPassesPlugin());

class PassingStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    new cdk.CfnResource(this, 'WaitHandle', {
      type: 'AWS::CloudFormation::WaitConditionHandle',
    });
  }
}

new PassingStack(app, `${stackPrefix}-validate-passing`);

app.synth();
