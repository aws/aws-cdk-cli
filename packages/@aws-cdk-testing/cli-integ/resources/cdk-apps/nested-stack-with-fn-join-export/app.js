const cdk = require('aws-cdk-lib');
const { aws_cloudformation: cfn, aws_sns: sns, aws_ssm: ssm } = cdk;

/**
 * Reproduces https://t.corp.amazon.com/D423570178
 *
 * When IncludeNestedStacks is true, CloudFormation validates all nested stacks
 * together. Export names using Fn::Join with a runtime reference get collapsed
 * to the placeholder {{IntrinsicFunction://Fn::Join}}, causing a false
 * "duplicate Export names" error when 2+ such exports exist across nested stacks.
 */

class NestedStackWithFnJoinExports extends cfn.NestedStack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const topic = new sns.Topic(this, 'Topic');
    new cdk.CfnOutput(this, 'ExportArn', {
      value: topic.topicArn,
      exportName: cdk.Fn.join(':', [props.runtimeRef, 'GetAtt', id, 'Arn']),
    });
    new cdk.CfnOutput(this, 'ExportName', {
      value: topic.topicName,
      exportName: cdk.Fn.join(':', [props.runtimeRef, 'GetAtt', id, 'Name']),
    });
  }
}

class NestedStacksFnJoinExportStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    // SSM parameter name is a runtime reference (not known at validation time)
    const param = new ssm.StringParameter(this, 'Param', { stringValue: 'value' });
    new NestedStackWithFnJoinExports(this, 'Nested1', { runtimeRef: param.parameterName });
    new NestedStackWithFnJoinExports(this, 'Nested2', { runtimeRef: param.parameterName });
  }
}

const app = new cdk.App();

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error('the STACK_NAME_PREFIX environment variable is required');
}

new NestedStacksFnJoinExportStack(app, `${stackPrefix}-nested-stacks-fn-join-export`);
app.synth();
