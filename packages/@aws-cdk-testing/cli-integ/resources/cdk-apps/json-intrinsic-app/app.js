const cdk = require('aws-cdk-lib/core');
const ecs = require('aws-cdk-lib/aws-ecs');
const ssm = require('aws-cdk-lib/aws-ssm');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

/**
 * Holds JSON built with an intrinsic (an Fn::Join, from Stack.toJsonString) in three places:
 *
 * - `<prefix>-json-intrinsic`: an SSM string parameter
 * - `<prefix>-json-intrinsic-nested`: an SSM string parameter in a nested stack
 * - `<prefix>-json-intrinsic-replace`: a container environment variable of an ECS task definition.
 *   Changing a parameter's value updates it in place, but any change to a task definition replaces it.
 *   This stack makes sure if a change is dropped, it won't affect the functionality of
 *   `--require-approval=destructive` and `--no-rollback`, which depend on replacement.
 *
 * Each test deploys without JSON_CHANGE (unset), then sets JSON_CHANGE to switch on these changes:
 *
 * ```
 * (unset)                   {"stack":"<stack name>","a":"1"}
 * change-value              {"stack":"<stack name>","a":"2"}
 * add-key                   {"stack":"<stack name>","a":"1","b":"2"}
 * add-key-with-token        {"stack":"<stack name>","a":"1","region":"<region>"}
 * reorder-keys              {"a":"1","stack":"<stack name>"}
 * same-value-with-fn-sub    {"stack":"<stack name>","a":"1"}, built with Fn::Sub instead of Fn::Join
 * ```
 *
 * Described with IncludePropertyValues, CloudFormation leaves `add-key`, `add-key-with-token` and
 * `reorder-keys` out of the change set, without a warning, or with one when the change is the task
 * definition replacement (https://github.com/aws/aws-cdk-cli/issues/2036).
 *
 * DESCRIPTION sets the description of the SSM parameter in `<prefix>-json-intrinsic` (default "d1").
 * This allows a test to change a separate property of the Parameter, and ensure that change is kept.
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
