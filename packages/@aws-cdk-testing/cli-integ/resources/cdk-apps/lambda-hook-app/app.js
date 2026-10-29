const cdk = require('aws-cdk-lib/core');
const iam = require('aws-cdk-lib/aws-iam');
const lambda = require('aws-cdk-lib/aws-lambda');
const s3 = require('aws-cdk-lib/aws-s3');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error('the STACK_NAME_PREFIX environment variable is required');
}

const testStackName = `${stackPrefix}-lambda-hook-test`;

// The detailed failure reason, only available through the hook result APIs
const hookFailureMessage = 'Ingress must not allow 0.0.0.0/0 to non-HTTP(s) ports';

// Setup a Lambda Hook that will fail change sets of the test stack
class LambdaHookSetupStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Hook handler that always fails with a detailed message
    const hookFunction = new lambda.Function(this, 'HookFunction', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          return {
            hookStatus: 'FAILED',
            errorCode: 'NonCompliant',
            message: ${JSON.stringify(hookFailureMessage)},
            clientRequestToken: event.clientRequestToken,
          };
        };
      `),
    });

    // IAM role for Lambda Hook execution
    const hookRole = new iam.Role(this, 'LambdaHookExecutionRole', {
      assumedBy: new iam.ServicePrincipal('hooks.cloudformation.amazonaws.com'),
    });
    hookFunction.grantInvoke(hookRole);

    // Lambda Hook - fails CHANGE_SET operations, but only for the test stack
    new cdk.CfnLambdaHook(this, 'LambdaHook', {
      alias: 'Private::Lambda::TestHook',
      executionRole: hookRole.roleArn,
      failureMode: 'FAIL',
      hookStatus: 'ENABLED',
      lambdaFunction: hookFunction.functionArn,
      targetOperations: ['CHANGE_SET'],
      stackFilters: {
        filteringCriteria: 'ALL',
        stackNames: {
          // Only evaluate the test stack, to not interfere with anything else in the account
          include: [testStackName],
        },
      },
    });
  }
}

class LambdaHookTestStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    new s3.CfnBucket(this, 'SomeBucket');
  }
}

const app = new cdk.App();
new LambdaHookSetupStack(app, `${stackPrefix}-lambda-hook-setup`);
new LambdaHookTestStack(app, testStackName);

app.synth();
