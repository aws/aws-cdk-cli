const cdk = require('aws-cdk-lib/core');
const lambda = require('aws-cdk-lib/aws-lambda');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

/**
 * A stack whose template changes with '@aws-cdk/aws-lambda:useCdkManagedLogGroup'
 * (an AWS::Logs::LogGroup is added for the function when the flag is enabled)
 */
class FlagsDiffStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    new lambda.Function(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
    });
  }
}

const app = new cdk.App();
new FlagsDiffStack(app, `${stackPrefix}-flags-diff`);

app.synth();
