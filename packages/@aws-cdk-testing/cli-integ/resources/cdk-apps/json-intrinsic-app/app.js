const cdk = require('aws-cdk-lib/core');
const ssm = require('aws-cdk-lib/aws-ssm');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

// A string parameter holding JSON that is built with an intrinsic, the way Stack.toJsonString renders
// it (the EKS KubernetesManifest and HelmChart constructs use it too). EXTRA_KEY adds a key to the
// JSON, a change CloudFormation leaves out of a change set described with IncludePropertyValues,
// without a warning. See aws/aws-cdk-cli#2036.
class JsonIntrinsicStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    new ssm.StringParameter(this, 'Param', {
      stringValue: this.toJsonString({
        stack: cdk.Aws.STACK_NAME,
        a: '1',
        ...(process.env.EXTRA_KEY ? { b: '2' } : {}),
      }),
    });
  }
}

const app = new cdk.App();
new JsonIntrinsicStack(app, `${stackPrefix}-json-intrinsic`);

app.synth();
