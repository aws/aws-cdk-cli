var cdk = require('aws-cdk-lib');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

class MyStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);
    new sns.Topic(this, 'topic');
  }
}

function getSsmParameterValue(scope, parameterName) {
  return ssm.StringParameter.valueFromLookup(scope, parameterName);
}

class YourStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);
    new sns.Topic(this, 'topic1');
    new sns.Topic(this, 'topic2');
  }
}

class NoticesStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);
    new sqs.Queue(this, 'queue');
  }
}

class SsoPermissionSetNoPolicy extends Stack {
  constructor(scope, id) {
    super(scope, id);

    new sso.CfnPermissionSet(this, "permission-set-without-managed-policy", {
      instanceArn: 'arn:aws:sso:::instance/testvalue',
      name: 'testName',
      permissionsBoundary: { customerManagedPolicyReference: { name: 'why', path: '/how/' } },
    })
  }
}

class SsoPermissionSetManagedPolicy extends Stack {
  constructor(scope, id) {
    super(scope, id);
    new sso.CfnPermissionSet(this, "permission-set-with-managed-policy", {
      managedPolicies: ['arn:aws:iam::aws:policy/administratoraccess'],
      customerManagedPolicyReferences: [{ name: 'forSSO' }],
      permissionsBoundary: { managedPolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess' },
      instanceArn: 'arn:aws:sso:::instance/testvalue',
      name: 'niceWork',
    })
  }
}

class SsoAssignment extends Stack {
  constructor(scope, id) {
    super(scope, id);
    new sso.CfnAssignment(this, "assignment", {
      instanceArn: 'arn:aws:sso:::instance/testvalue',
      permissionSetArn: 'arn:aws:sso:::testvalue',
      principalId: '11111111-2222-3333-4444-test',
      principalType: 'USER',
      targetId: '111111111111',
      targetType: 'AWS_ACCOUNT'
    });
  }
}

class SsoInstanceAccessControlConfig extends Stack {
  constructor(scope, id) {
    super(scope, id);
    new sso.CfnInstanceAccessControlAttributeConfiguration(this, 'instanceAccessControlConfig', {
      instanceArn: 'arn:aws:sso:::instance/testvalue',
      accessControlAttributes: [
        { key: 'first', value: { source: ['a'] } },
        { key: 'second', value: { source: ['b'] } },
        { key: 'third', value: { source: ['c'] } },
        { key: 'fourth', value: { source: ['d'] } },
        { key: 'fifth', value: { source: ['e'] } },
        { key: 'sixth', value: { source: ['f'] } },
      ]
    })
  }
}

class ListMultipleDependentStack extends Stack {
  constructor(scope, id) {
    super(scope, id);

    const dependentStack1 = new DependentStack1(this, 'DependentStack1');
    const dependentStack2 = new DependentStack2(this, 'DependentStack2');

    this.addDependency(dependentStack1);
    this.addDependency(dependentStack2);
  }
}

class DependentStack1 extends Stack {
  constructor(scope, id) {
    super(scope, id);

  }
}

class DependentStack2 extends Stack {
  constructor(scope, id) {
    super(scope, id);

  }
}

class ListStack extends Stack {
  constructor(scope, id) {
    super(scope, id);

    const dependentStack = new DependentStack(this, 'DependentStack');

    this.addDependency(dependentStack);
  }
}

class DependentStack extends Stack {
  constructor(scope, id) {
    super(scope, id);

    const innerDependentStack = new InnerDependentStack(this, 'InnerDependentStack');

    this.addDependency(innerDependentStack);
  }
}

class InnerDependentStack extends Stack {
  constructor(scope, id) {
    super(scope, id);

  }
}

class MigrateStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    if (!process.env.OMIT_TOPIC) {
      const queue = new sqs.Queue(this, 'Queue', {
        removalPolicy: process.env.ORPHAN_TOPIC ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      });

      new cdk.CfnOutput(this, 'QueueName', {
        value: queue.queueName,
      });

      new cdk.CfnOutput(this, 'QueueUrl', {
        value: queue.queueUrl,
      });

      new cdk.CfnOutput(this, 'QueueLogicalId', {
        value: queue.node.defaultChild.logicalId,
      });
    }
    if (process.env.SAMPLE_RESOURCES) {
      const myTopic = new sns.Topic(this, 'migratetopic1', {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      cdk.Tags.of(myTopic).add('tag1', 'value1');
      const myTopic2 = new sns.Topic(this, 'migratetopic2', {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      cdk.Tags.of(myTopic2).add('tag2', 'value2');
      const myQueue = new sqs.Queue(this, 'migratequeue1', {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      cdk.Tags.of(myQueue).add('tag3', 'value3');
    }
    if (process.env.LAMBDA_RESOURCES) {
      const myFunction = new lambda.Function(this, 'migratefunction1', {
        code: lambda.Code.fromInline('console.log("hello world")'),
        handler: 'index.handler',
        runtime: lambda.Runtime.NODEJS_18_X,
      });
      cdk.Tags.of(myFunction).add('lambda-tag', 'lambda-value');

      const myFunction2 = new lambda.Function(this, 'migratefunction2', {
        code: lambda.Code.fromInline('console.log("hello world2")'),
        handler: 'index.handler',
        runtime: lambda.Runtime.NODEJS_18_X,
      });
      cdk.Tags.of(myFunction2).add('lambda-tag', 'lambda-value');
    }
  }
}

class ImportableStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);
    new cdk.CfnWaitConditionHandle(this, 'Handle');

    if (process.env.INCLUDE_SINGLE_QUEUE === '1') {
      const queue = new sqs.Queue(this, 'Queue', {
        removalPolicy: (process.env.RETAIN_SINGLE_QUEUE === '1') ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      });

      new cdk.CfnOutput(this, 'QueueName', {
        value: queue.queueName,
      });

      new cdk.CfnOutput(this, 'QueueUrl', {
        value: queue.queueUrl,
      });

      new cdk.CfnOutput(this, 'QueueLogicalId', {
        value: queue.node.defaultChild.logicalId,
      });
    }

    if (process.env.INCLUDE_SINGLE_BUCKET === '1') {
      const bucket = new s3.Bucket(this, 'test-bucket', {
        removalPolicy: (process.env.RETAIN_SINGLE_BUCKET === '1') ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      });

      new cdk.CfnOutput(this, 'BucketLogicalId', {
        value: bucket.node.defaultChild.logicalId,
      });

      new cdk.CfnOutput(this, 'BucketName', {
        value: bucket.bucketName,
      });
    }

    if (process.env.LARGE_TEMPLATE === '1') {
      for (let i = 1; i <= 70; i++) {
        new sqs.Queue(this, `cdk-import-queue-test${i}`, {
          enforceSSL: true,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
      }
    }

    if (process.env.INCLUDE_NODEJS_FUNCTION_LAMBDA === '1') {
      new node_lambda.NodejsFunction(
        this,
        'cdk-import-nodejs-lambda-test',
        {
          bundling: {
            minify: true,
            sourceMap: false,
            sourcesContent: false,
            target: 'ES2020',
            forceDockerBundling: true,
          },
          runtime: lambda.Runtime.NODEJS_18_X,
          entry: path.join(__dirname, 'lambda/index.js')
        }
      )
    }
  }
}

class StackUsingContext extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);
    new cdk.CfnResource(this, 'Handle', {
      type: 'AWS::CloudFormation::WaitConditionHandle'
    });

    new cdk.CfnOutput(this, 'Output', {
      value: this.availabilityZones[0],
    });
  }
}

class ParameterStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    new sns.Topic(this, 'TopicParameter', {
      topicName: new cdk.CfnParameter(this, 'TopicNameParam').valueAsString
    });
  }
}

class OtherParameterStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    new sns.Topic(this, 'TopicParameter', {
      topicName: new cdk.CfnParameter(this, 'OtherTopicNameParam').valueAsString
    });
  }
}

class MultiParameterStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    new sns.Topic(this, 'TopicParameter', {
      displayName: new cdk.CfnParameter(this, 'DisplayNameParam').valueAsString
    });
    new sns.Topic(this, 'OtherTopicParameter', {
      displayName: new cdk.CfnParameter(this, 'OtherDisplayNameParam').valueAsString
    });
  }
}

class OutputsStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    const topic = new sns.Topic(this, 'MyOutput', {
      topicName: `${cdk.Stack.of(this).stackName}MyTopic`
    });

    new cdk.CfnOutput(this, 'TopicName', {
      value: topic.topicName
    })
  }
}

class TwoSnsTopics extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    new sns.Topic(this, 'Topic1');
    new sns.Topic(this, 'Topic2');

  }
}

class AnotherOutputsStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    const topic = new sns.Topic(this, 'MyOtherOutput', {
      topicName: `${cdk.Stack.of(this).stackName}MyOtherTopic`
    });

    new cdk.CfnOutput(this, 'TopicName', {
      value: topic.topicName
    });
  }
}

class IamStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    new iam.Role(this, 'SomeRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
    });
  }
}

class ProvidingStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    this.topic = new sns.Topic(this, 'BogusTopic'); // Some filler
  }
}

class StackWithError extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    this.topic = new sns.Topic(this, 'BogusTopic'); // Some filler
    Annotations.of(this).addError('This is an error');
  }
}

class StageWithError extends cdk.Stage {
  constructor(parent, id, props) {
    super(parent, id, props);

    new StackWithError(this, 'Stack');
  }
}

class ConsumingStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    new sns.Topic(this, 'BogusTopic');  // Some filler
    new cdk.CfnOutput(this, 'IConsumedSomething', { value: props.providingStack.topic.topicArn });
  }
}

class MissingSSMParameterStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    const parameterName = constructs.Node.of(this).tryGetContext('test:ssm-parameter-name');
    if (parameterName) {
      const param = getSsmParameterValue(this, parameterName);
      new iam.Role(this, 'PhonyRole', { assumedBy: new iam.AccountPrincipal(param) });
    }
  }
}

class LambdaStack extends cdk.Stack {
  constructor(parent, id, props) {
    // sometimes we need to specify the custom bootstrap bucket to use
    // see the 'upgrade legacy bootstrap stack' test
    const synthesizer = parent.node.tryGetContext('legacySynth') === 'true' ?
      new LegacyStackSynthesizer({
        fileAssetsBucketName: parent.node.tryGetContext('bootstrapBucket'),
      })
      : new DefaultStackSynthesizer({
        fileAssetsBucketName: parent.node.tryGetContext('bootstrapBucket'),
      })
    super(parent, id, {
      ...props,
      synthesizer: synthesizer,
    });

    const fn = new lambda.Function(this, 'my-function', {
      code: lambda.Code.asset(path.join(__dirname, 'lambda')),
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler'
    });

    new cdk.CfnOutput(this, 'FunctionArn', { value: fn.functionArn });
  }
}

class DriftableStack extends cdk.Stack {
  constructor(parent, id, props) {
    const synthesizer = parent.node.tryGetContext('legacySynth') === 'true' ?
      new LegacyStackSynthesizer({
        fileAssetsBucketName: parent.node.tryGetContext('bootstrapBucket'),
      })
      : new DefaultStackSynthesizer({
        fileAssetsBucketName: parent.node.tryGetContext('bootstrapBucket'),
      })
    super(parent, id, {
      ...props,
      synthesizer: synthesizer,
    });

    const fn = new lambda.Function(this, 'my-function', {
      code: lambda.Code.asset(path.join(__dirname, 'lambda')),
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      description: 'This is my function!',
      timeout: cdk.Duration.seconds(5),
      memorySize: 128
    });

    new cdk.CfnOutput(this, 'FunctionArn', { value: fn.functionArn });
  }
}

class EarlyValidationStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    new s3.Bucket(this, 'MyBucket', {
      bucketName: process.env.BUCKET_NAME,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}

class IamRolesStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    // Environment variabile is used to create a bunch of roles to test
    // that large diff templates are uploaded to S3 to create the changeset.
    for (let i = 1; i <= Number(process.env.NUMBER_OF_ROLES); i++) {
      const role = new iam.Role(this, `Role${i}`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      });
      const cfnRole = role.node.defaultChild;

      // For any extra IAM roles created, add a ton of metadata so that the template size is > 50 KiB.
      if (i > 1) {
        for (let i = 1; i <= 30; i++) {
          cfnRole.addMetadata('a'.repeat(1000), 'v');
        }
      }
    }
  }
}

class SessionTagsStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, {
      ...props,
      synthesizer: new DefaultStackSynthesizer({
        deployRoleAdditionalOptions: {
          Tags: [{ Key: 'Department', Value: 'Engineering' }]
        },
        fileAssetPublishingRoleAdditionalOptions: {
          Tags: [{ Key: 'Department', Value: 'Engineering' }]
        },
        imageAssetPublishingRoleAdditionalOptions: {
          Tags: [{ Key: 'Department', Value: 'Engineering' }]
        },
        lookupRoleAdditionalOptions: {
          Tags: [{ Key: 'Department', Value: 'Engineering' }]
        }
      })
    });

    // VPC lookup to test LookupRole
    ec2.Vpc.fromLookup(this, 'DefaultVPC', { isDefault: true });

    // Lambda Function to test AssetPublishingRole
    const fn = new lambda.Function(this, 'my-function', {
      code: lambda.Code.asset(path.join(__dirname, 'lambda')),
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler'
    });

    // DockerImageAsset to test ImageAssetPublishingRole
    new docker.DockerImageAsset(this, 'image', {
      directory: path.join(__dirname, 'docker')
    });
  }
}

class NoExecutionRoleCustomSynthesizer extends cdk.DefaultStackSynthesizer {

  emitArtifact(session, options) {
    super.emitArtifact(session, {
      ...options,
      cloudFormationExecutionRoleArn: undefined,
    })
  }
}

class SessionTagsWithNoExecutionRoleCustomSynthesizerStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, {
      ...props,
      synthesizer: new NoExecutionRoleCustomSynthesizer({
        deployRoleAdditionalOptions: {
          Tags: [{ Key: 'Department', Value: 'Engineering' }]
        },
      })
    });

    new sqs.Queue(this, 'sessionTagsQueue');
  }
}
class LambdaHotswapStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    const fn = new lambda.Function(this, 'my-function', {
      code: lambda.Code.asset(path.join(__dirname, 'lambda')),
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      description: process.env.DYNAMIC_LAMBDA_PROPERTY_VALUE ?? "description",
      environment: {
        SomeVariable:
          process.env.DYNAMIC_LAMBDA_PROPERTY_VALUE ?? "environment",
        ImportValueVariable: process.env.USE_IMPORT_VALUE_LAMBDA_PROPERTY
          ? cdk.Fn.importValue(TEST_EXPORT_OUTPUT_NAME)
          : "no-import",
      },
    });

    new cdk.CfnOutput(this, 'FunctionName', { value: fn.functionName });
  }
}

class EcsHotswapStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    // define a simple vpc and cluster
    const vpc = new ec2.Vpc(this, 'vpc', {
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
      maxAzs: 1,
    });
    const cluster = new ecs.Cluster(this, 'cluster', {
      vpc,
    });

    // allow stack to be used to test failed deployments
    const image =
      process.env.USE_INVALID_ECS_HOTSWAP_IMAGE == 'true'
        ? 'nginx:invalidtag'
        : 'nginx:alpine';

    // deploy basic service
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'task-definition'
    );
    taskDefinition.addContainer('nginx', {
      image: ecs.ContainerImage.fromRegistry(image),
      environment: {
        SOME_VARIABLE: process.env.DYNAMIC_ECS_PROPERTY_VALUE ?? 'environment',
      },
      healthCheck: {
        command: ['CMD-SHELL', 'exit 0'], // fake health check to speed up deployment
        interval: cdk.Duration.seconds(5),
      },
    });
    const service = new ecs.FargateService(this, 'service', {
      cluster,
      taskDefinition,
      assignPublicIp: true, // required without NAT to pull image
      circuitBreaker: { rollback: false },
      desiredCount: 1,
    });

    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'ServiceName', { value: service.serviceName });
  }
}

class AgentCoreHotswapStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    const role = new iam.Role(this, 'RuntimeRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
      ],
    });

    const image = new docker.DockerImageAsset(this, 'Image', {
      directory: path.join(__dirname, 'docker'),
      platform: docker.Platform.LINUX_ARM64,
    });
    image.repository.grantPull(role);

    const runtime = new bedrockagentcore.CfnRuntime(this, 'Runtime', {
      agentRuntimeName: 'test_runtime',
      roleArn: role.roleArn,
      networkConfiguration: {
        networkMode: 'PUBLIC',
      },
      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: image.imageUri,
        },
      },
      description: process.env.DYNAMIC_BEDROCK_RUNTIME_DESCRIPTION ?? 'runtime',
      environmentVariables: {
        TEST_VAR: process.env.DYNAMIC_BEDROCK_RUNTIME_ENV_VAR ?? 'original',
      },
    });
    runtime.node.addDependency(role);
    new cdk.CfnOutput(this, 'RuntimeId', { value: runtime.ref });
  }
}

class DockerStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    new docker.DockerImageAsset(this, 'image', {
      directory: path.join(__dirname, 'docker')
    });

    // Add at least a single resource (WaitConditionHandle), otherwise this stack will never
    // be deployed (and its assets never built)
    new cdk.CfnResource(this, 'Handle', {
      type: 'AWS::CloudFormation::WaitConditionHandle'
    });
  }
}

class DockerInUseStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    // Use the docker file in a lambda otherwise it will not be referenced in the template
    const fn = new lambda.Function(this, 'my-function', {
      code: lambda.Code.fromAssetImage(path.join(__dirname, 'docker')),
      runtime: lambda.Runtime.FROM_IMAGE,
      handler: lambda.Handler.FROM_IMAGE,
    });
  }
}

class DockerStackWithCustomFile extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    new docker.DockerImageAsset(this, 'image', {
      directory: path.join(__dirname, 'docker'),
      file: 'Dockerfile.Custom'
    });

    // Add at least a single resource (WaitConditionHandle), otherwise this stack will never
    // be deployed (and its assets never built)
    new cdk.CfnResource(this, 'Handle', {
      type: 'AWS::CloudFormation::WaitConditionHandle'
    });
  }
}

class MultipleDockerAssetsStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    new docker.DockerImageAsset(this, 'image1', {
      directory: path.join(__dirname, 'docker-concurrent/image1')
    });
    new docker.DockerImageAsset(this, 'image2', {
      directory: path.join(__dirname, 'docker-concurrent/image2')
    });
    new docker.DockerImageAsset(this, 'image3', {
      directory: path.join(__dirname, 'docker-concurrent/image3')
    });

    // Add at least a single resource (WaitConditionHandle), otherwise this stack will never
    // be deployed (and its assets never built)
    new cdk.CfnResource(this, 'Handle', {
      type: 'AWS::CloudFormation::WaitConditionHandle'
    });
  }
}

/**
 * A stack that will never succeed deploying (done in a way that CDK cannot detect but CFN will complain about)
 */
class FailedStack extends cdk.Stack {

  constructor(parent, id, props) {
    super(parent, id, props);

    // fails on 'Property PolicyDocument cannot be empty'.
    new cdk.CfnResource(this, 'EmptyPolicy', {
      type: 'AWS::IAM::Policy'
    })

  }

}

const VPC_TAG_NAME = 'custom-tag';
const VPC_TAG_VALUE = `${stackPrefix}-bazinga!`;

class DefineVpcStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    const vpc = new ec2.Vpc(this, 'VPC', {
      maxAzs: 1,
    })
    cdk.Aspects.of(vpc).add(new cdk.Tag(VPC_TAG_NAME, VPC_TAG_VALUE));
  }
}

class ImportVpcStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    ec2.Vpc.fromLookup(this, 'DefaultVPC', { isDefault: true });
    ec2.Vpc.fromLookup(this, 'ByTag', { tags: { [VPC_TAG_NAME]: VPC_TAG_VALUE } });
  }
}

class ConditionalResourceStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    if (!process.env.NO_RESOURCE) {
      new iam.User(this, 'User');
    }
  }
}

const TEST_EXPORT_OUTPUT_NAME = 'test-export-output';

class ExportValueStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    // just need any resource to exist within the stack
    const topic = new sns.Topic(this, 'Topic');

    new cdk.CfnOutput(this, 'ExportValueOutput', {
      exportName: TEST_EXPORT_OUTPUT_NAME,
      value: topic.topicArn,
    });
  }
}

class BundlingStage extends cdk.Stage {
  constructor(parent, id, props) {
    super(parent, id, props);
    const stack = new cdk.Stack(this, 'BundlingStack');

    new lambda.Function(stack, 'Handler', {
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda')),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_LATEST,
    });
  }
}

class SomeStage extends cdk.Stage {
  constructor(parent, id, props) {
    super(parent, id, props);

    new YourStack(this, 'StackInStage');
  }
}

class StageUsingContext extends cdk.Stage {
  constructor(parent, id, props) {
    super(parent, id, props);

    new StackUsingContext(this, 'StackInStage');
  }
}

class BuiltinLambdaStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    new s3.Bucket(this, 'Bucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // will deploy a Nodejs lambda backed custom resource
    });
  }
}

class NotificationArnsStack extends cdk.Stack {
  constructor(parent, id, props) {

    const arnsFromEnv = process.env.INTEG_NOTIFICATION_ARNS;
    super(parent, id, {
      ...props,
      // comma separated list of arns.
      // empty string means empty list.
      // undefined means undefined
      notificationArns: arnsFromEnv == '' ? [] : (arnsFromEnv ? arnsFromEnv.split(',') : undefined)
    });

    new cdk.CfnWaitConditionHandle(this, 'WaitConditionHandle');

  }
}

class AppSyncHotswapStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    const api = new appsync.GraphqlApi(this, "Api", {
      name: "appsync-hotswap",
      definition: appsync.Definition.fromFile(path.join(__dirname, 'appsync.hotswap.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.IAM,
        },
      },
    });

    const noneDataSource = api.addNoneDataSource("none");
    // create 50 appsync functions to hotswap
    for (const i of Array(50).keys()) {
      const appsyncFunction = new appsync.AppsyncFunction(this, `Function${i}`, {
        name: `appsync_function${i}`,
        api,
        dataSource: noneDataSource,
        requestMappingTemplate: appsync.MappingTemplate.fromString(process.env.DYNAMIC_APPSYNC_PROPERTY_VALUE ?? "$util.toJson({})"),
        responseMappingTemplate: appsync.MappingTemplate.fromString('$util.toJson({})'),
      });
    }
  }
}

class MetadataStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);
    const handle = new cdk.CfnWaitConditionHandle(this, 'WaitConditionHandle');
    handle.addMetadata('Key', process.env.INTEG_METADATA_VALUE ?? 'default')

  }
}

if (!process.stdout.isTTY() || !process.stdout.isTTY()) {
  throw new Error('CHECK_TTY is set to true, but stdout or stderr is not attached to a TTY');
}

const app = new cdk.App({
  context: {
    '@aws-cdk/core:assetHashSalt': process.env.CODEBUILD_BUILD_ID ?? process.env.GITHUB_RUN_ID, // Force all assets to be unique, but consistent in one build
  },
});

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION
};

new MyStack(app, `${stackPrefix}-MyStack`, { env });

app.synth();
