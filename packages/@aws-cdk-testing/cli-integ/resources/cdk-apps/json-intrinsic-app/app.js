const cdk = require('aws-cdk-lib/core');
const ecs = require('aws-cdk-lib/aws-ecs');
const ssm = require('aws-cdk-lib/aws-ssm');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

// A string parameter holding JSON that is built with an intrinsic, the way Stack.toJsonString renders
// it (the EKS KubernetesManifest and HelmChart constructs use it too). VARIANT changes the JSON in a
// way that CloudFormation leaves out of a change set described with IncludePropertyValues, without a
// warning (on its own, or together with the description), changes a value (which CloudFormation does
// list), or rewrites it so that it resolves to the same value. See aws/aws-cdk-cli#2036.
class JsonIntrinsicStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    new ssm.StringParameter(this, 'Param', {
      stringValue: jsonValue(this, process.env.VARIANT),
      description: process.env.VARIANT === 'add-key-and-description' ? 'd2' : 'd1',
    });
  }
}

// The same value in a container environment variable of an ECS task definition. Any change to the
// container definitions replaces the task definition. CloudFormation leaves that replacement out of a
// change set described with IncludePropertyValues too, but says so in a warning.
class JsonIntrinsicReplaceStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const taskDefinition = new ecs.TaskDefinition(this, 'Task', {
      compatibility: ecs.Compatibility.FARGATE,
      cpu: '256',
      memoryMiB: '512',
    });
    taskDefinition.addContainer('Container', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/busybox:latest'),
      environment: { CONFIG: jsonValue(this, process.env.VARIANT) },
    });
  }
}

// The same parameter in a nested stack.
class JsonIntrinsicNestedStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const nested = new cdk.NestedStack(this, 'Nested');
    new ssm.StringParameter(nested, 'Param', { stringValue: jsonValue(nested, process.env.VARIANT) });
  }
}

function jsonValue(stack, variant) {
  switch (variant) {
    case undefined:
      return stack.toJsonString({ stack: cdk.Aws.STACK_NAME, a: '1' });
    case 'change-value':
      return stack.toJsonString({ stack: cdk.Aws.STACK_NAME, a: '2' });
    case 'add-key':
    case 'add-key-and-description':
      return stack.toJsonString({ stack: cdk.Aws.STACK_NAME, a: '1', b: '2' });
    case 'add-key-with-token':
      return stack.toJsonString({ stack: cdk.Aws.STACK_NAME, a: '1', region: cdk.Aws.REGION });
    case 'reorder-keys':
      return stack.toJsonString({ a: '1', stack: cdk.Aws.STACK_NAME });
    case 'same-value-with-fn-sub':
      return cdk.Fn.sub('{"stack":"${AWS::StackName}","a":"1"}');
    default:
      throw new Error(`unknown VARIANT: ${variant}`);
  }
}

const app = new cdk.App();
new JsonIntrinsicStack(app, `${stackPrefix}-json-intrinsic`);
new JsonIntrinsicReplaceStack(app, `${stackPrefix}-json-intrinsic-replace`);
new JsonIntrinsicNestedStack(app, `${stackPrefix}-json-intrinsic-nested`);

app.synth();
