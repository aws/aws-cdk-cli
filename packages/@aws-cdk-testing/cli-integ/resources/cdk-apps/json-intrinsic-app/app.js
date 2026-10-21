const cdk = require('aws-cdk-lib/core');
const ecs = require('aws-cdk-lib/aws-ecs');
const ssm = require('aws-cdk-lib/aws-ssm');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

/**
 * Holds JSON built with an intrinsic, the way Stack.toJsonString renders it (the EKS KubernetesManifest
 * and HelmChart constructs use it too), in three places. See aws/aws-cdk-cli#2036.
 *
 * - `<prefix>-json-intrinsic`: an SSM string parameter
 * - `<prefix>-json-intrinsic-replace`: a container environment variable of an ECS task definition. Any
 *   change to it replaces the task definition.
 * - `<prefix>-json-intrinsic-nested`: an SSM string parameter in a nested stack
 *
 * The JSON is `{"stack":"<stack name>","a":"1"}`, changed by JSON_CHANGE:
 *
 * - (unset): no change
 * - `change-value`: `a` becomes "2" (CloudFormation lists this change)
 * - `add-key`: adds `"b":"2"`
 * - `add-key-with-token`: adds `"region":"<region>"`
 * - `reorder-keys`: puts `a` before `stack`
 * - `same-value-with-fn-sub`: the same JSON, built with Fn::Sub instead of Fn::Join
 *
 * Described with IncludePropertyValues, CloudFormation leaves `add-key`, `add-key-with-token` and
 * `reorder-keys` out of the change set, without a warning (with a warning when the change is the task
 * definition replacement).
 *
 * DESCRIPTION sets the description of the SSM parameter in `<prefix>-json-intrinsic` (default "d1").
 *
 * To exercise this app:
 *
 * ```
 * npx cdk deploy <prefix>-json-intrinsic
 * env JSON_CHANGE=add-key npx cdk diff --method=change-set <prefix>-json-intrinsic
 * env JSON_CHANGE=add-key DESCRIPTION=d2 npx cdk deploy --require-approval=any-change <prefix>-json-intrinsic
 * ```
 */
class JsonIntrinsicStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    new ssm.StringParameter(this, 'Param', {
      stringValue: jsonValue(this, process.env.JSON_CHANGE),
      description: process.env.DESCRIPTION ?? 'd1',
    });
  }
}

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
      environment: { CONFIG: jsonValue(this, process.env.JSON_CHANGE) },
    });
  }
}

class JsonIntrinsicNestedStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const nested = new cdk.NestedStack(this, 'Nested');
    new ssm.StringParameter(nested, 'Param', { stringValue: jsonValue(nested, process.env.JSON_CHANGE) });
  }
}

function jsonValue(stack, change) {
  switch (change) {
    case undefined:
      return stack.toJsonString({ stack: cdk.Aws.STACK_NAME, a: '1' });
    case 'change-value':
      return stack.toJsonString({ stack: cdk.Aws.STACK_NAME, a: '2' });
    case 'add-key':
      return stack.toJsonString({ stack: cdk.Aws.STACK_NAME, a: '1', b: '2' });
    case 'add-key-with-token':
      return stack.toJsonString({ stack: cdk.Aws.STACK_NAME, a: '1', region: cdk.Aws.REGION });
    case 'reorder-keys':
      return stack.toJsonString({ a: '1', stack: cdk.Aws.STACK_NAME });
    case 'same-value-with-fn-sub':
      return cdk.Fn.sub('{"stack":"${AWS::StackName}","a":"1"}');
    default:
      throw new Error(`unknown JSON_CHANGE: ${change}`);
  }
}

const app = new cdk.App();
new JsonIntrinsicStack(app, `${stackPrefix}-json-intrinsic`);
new JsonIntrinsicReplaceStack(app, `${stackPrefix}-json-intrinsic-replace`);
new JsonIntrinsicNestedStack(app, `${stackPrefix}-json-intrinsic-nested`);

app.synth();
