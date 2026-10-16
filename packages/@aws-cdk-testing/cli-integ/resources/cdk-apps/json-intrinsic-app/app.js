const cdk = require('aws-cdk-lib/core');
const ssm = require('aws-cdk-lib/aws-ssm');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

// A string parameter holding JSON that is built with an intrinsic, the way Stack.toJsonString renders
// it (the EKS KubernetesManifest and HelmChart constructs use it too). VARIANT changes the JSON in a
// way that CloudFormation leaves out of a change set described with IncludePropertyValues, without a
// warning, changes a value (which CloudFormation does list), or rewrites it so that it resolves to the
// same value. See aws/aws-cdk-cli#2036.
class JsonIntrinsicStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    new ssm.StringParameter(this, 'Param', { stringValue: this.parameterValue(process.env.VARIANT) });
  }

  parameterValue(variant) {
    switch (variant) {
      case undefined:
        return this.toJsonString({ stack: cdk.Aws.STACK_NAME, a: '1' });
      case 'change-value':
        return this.toJsonString({ stack: cdk.Aws.STACK_NAME, a: '2' });
      case 'add-key':
        return this.toJsonString({ stack: cdk.Aws.STACK_NAME, a: '1', b: '2' });
      case 'add-key-with-token':
        return this.toJsonString({ stack: cdk.Aws.STACK_NAME, a: '1', region: cdk.Aws.REGION });
      case 'reorder-keys':
        return this.toJsonString({ a: '1', stack: cdk.Aws.STACK_NAME });
      case 'same-value-with-fn-sub':
        return cdk.Fn.sub('{"stack":"${AWS::StackName}","a":"1"}');
      default:
        throw new Error(`unknown VARIANT: ${variant}`);
    }
  }
}

const app = new cdk.App();
new JsonIntrinsicStack(app, `${stackPrefix}-json-intrinsic`);

app.synth();
