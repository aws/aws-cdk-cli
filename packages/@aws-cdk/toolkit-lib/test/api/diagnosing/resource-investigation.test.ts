import { DescribeStackResourcesCommand, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import {
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  ListTasksCommand,
} from '@aws-sdk/client-ecs';
import { GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda';
import { parseLambdaLogEvents } from '../../../lib/api/diagnosing/format-utils';
import {
  assumedRoleSessionName,
  extractLogStreamName,
  functionNameFromArnOrName,
  identityMatches,
  nameSegment,
  parseEcsServiceIdentifier,
  serviceTokenReferencedLogicalId,
} from '../../../lib/api/diagnosing/resource-identifiers';
import { investigateResource } from '../../../lib/api/diagnosing/resource-investigation';
import type { ResourceError } from '../../../lib/api/stack-events/resource-errors';
import {
  mockCloudFormationClient,
  mockCloudWatchClient,
  mockECSClient,
  mockLambdaClient,
  MockSdk,
  restoreSdkMocksToDefault,
} from '../../_helpers/mock-sdk';

let sdk: MockSdk;
const debug = async (_msg: string) => {
};

beforeEach(() => {
  sdk = new MockSdk();
  restoreSdkMocksToDefault();
});

function ecsServiceError(physicalId: string | undefined): ResourceError {
  return {
    stackArn: 'arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/abc',
    parentStackLogicalIds: [],
    logicalId: 'Service',
    resourceType: 'AWS::ECS::Service',
    physicalId,
    message: 'Service did not stabilize',
  };
}

describe('parseEcsServiceIdentifier', () => {
  test('parses a long-format service ARN', () => {
    expect(parseEcsServiceIdentifier(
      'arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service',
    )).toEqual({ cluster: 'my-cluster', serviceName: 'my-service' });
  });

  test('parses a cluster/service path', () => {
    expect(parseEcsServiceIdentifier('my-cluster/my-service'))
      .toEqual({ cluster: 'my-cluster', serviceName: 'my-service' });
  });

  test('parses a bare service name as service-only', () => {
    expect(parseEcsServiceIdentifier('my-service'))
      .toEqual({ serviceName: 'my-service' });
  });

  test('returns empty for an unrecognized multi-segment string', () => {
    expect(parseEcsServiceIdentifier('a/b/c')).toEqual({});
  });

  test('handles partitions other than aws (gov, cn)', () => {
    expect(parseEcsServiceIdentifier(
      'arn:aws-cn:ecs:cn-north-1:123456789012:service/my-cluster/my-service',
    )).toEqual({ cluster: 'my-cluster', serviceName: 'my-service' });
  });
});

describe('investigateResource for AWS::ECS::Service', () => {
  test('returns empty when physicalId is missing', async () => {
    const result = await investigateResource(ecsServiceError(undefined), sdk, debug);
    expect(result).toEqual([]);
  });

  test('returns empty when describeServices yields no service', async () => {
    mockECSClient.on(DescribeServicesCommand).resolves({ services: [] });

    const result = await investigateResource(
      ecsServiceError('my-cluster/my-service'),
      sdk,
      debug,
    );
    expect(result).toEqual([]);
  });

  test('suggests --no-rollback when the service is gone and rollback was enabled', async () => {
    mockECSClient.on(DescribeServicesCommand).resolves({ services: [] });

    const result = await investigateResource(
      ecsServiceError('my-cluster/my-service'),
      sdk,
      debug,
      { rollbackEnabled: true },
    );

    const ctx = result.find(c => c.source === 'ECS Service');
    expect(ctx).toBeDefined();
    expect(ctx!.messages.join('\n')).toMatch(/--no-rollback/);
  });

  test('does not suggest --no-rollback when rollback was already disabled', async () => {
    mockECSClient.on(DescribeServicesCommand).resolves({ services: [] });

    const result = await investigateResource(
      ecsServiceError('my-cluster/my-service'),
      sdk,
      debug,
      { rollbackEnabled: false },
    );

    expect(result).toEqual([]);
  });

  test('returns empty when investigation is not supported for the resource type', async () => {
    const err: ResourceError = {
      ...ecsServiceError('foo'),
      resourceType: 'AWS::S3::Bucket',
    };
    const result = await investigateResource(err, sdk, debug);
    expect(result).toEqual([]);
  });

  test('emits a stopped-tasks context with the latest failed task details', async () => {
    mockECSClient.on(DescribeServicesCommand).resolves({
      services: [{
        serviceName: 'my-service',
        taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:5',
        events: [],
      }],
    });
    mockECSClient.on(ListTasksCommand).resolves({
      taskArns: ['arn:aws:ecs:us-east-1:123456789012:task/my-cluster/abc12345aaaabbbbcccc1111deadbeef'],
    });
    mockECSClient.on(DescribeTasksCommand).resolves({
      tasks: [{
        stoppedReason: 'Essential container exited',
        containers: [
          { name: 'app', reason: 'CannotPullContainerError: image not found', exitCode: 1 },
        ],
      }],
    });
    mockECSClient.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: { containerDefinitions: [] },
    });

    const result = await investigateResource(
      ecsServiceError('arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service'),
      sdk,
      debug,
    );

    expect(mockECSClient).toHaveReceivedCommandWith(DescribeTasksCommand, {
      cluster: 'my-cluster',
      tasks: ['abc12345aaaabbbbcccc1111deadbeef'],
    });

    const stopped = result.find(c => c.source === 'ECS Stopped Tasks');
    expect(stopped).toBeDefined();
    expect(stopped!.messages).toEqual(expect.arrayContaining([
      'Task stopped: Essential container exited',
      'Container "app": CannotPullContainerError: image not found',
      'Container "app" exited with code 1',
    ]));
    expect(stopped!.link).toContain('clusters/my-cluster/services/my-service');
  });

  test('scopes the stopped-task lookup to the service', async () => {
    mockECSClient.on(DescribeServicesCommand).resolves({
      services: [{
        serviceName: 'my-service',
        taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:5',
        events: [],
      }],
    });
    mockECSClient.on(ListTasksCommand).resolves({
      taskArns: ['arn:aws:ecs:us-east-1:123456789012:task/my-cluster/ffffffff99998888'],
    });
    mockECSClient.on(DescribeTasksCommand).resolves({
      tasks: [{ stoppedReason: 'Essential container exited', containers: [] }],
    });
    mockECSClient.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: { containerDefinitions: [] },
    });

    await investigateResource(
      ecsServiceError('my-cluster/my-service'),
      sdk,
      debug,
    );

    expect(mockECSClient).toHaveReceivedCommandWith(ListTasksCommand, {
      cluster: 'my-cluster',
      serviceName: 'my-service',
      desiredStatus: 'STOPPED',
    });
    expect(mockECSClient).toHaveReceivedCommandWith(DescribeTasksCommand, {
      cluster: 'my-cluster',
      tasks: ['ffffffff99998888'],
    });
  });

  test('falls back to listing the cluster when the service-scoped lookup is empty', async () => {
    mockECSClient.on(DescribeServicesCommand).resolves({
      services: [{
        serviceName: 'my-service',
        taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:5',
        events: [],
      }],
    });
    // First (service-scoped) listTasks call returns nothing; the second (cluster-wide)
    // fallback call returns the stopped task. Sequenced with resolvesOnce so the fallback
    // path is genuinely required — partial input matchers would overlap and let the first
    // call satisfy the cluster-wide mock, masking a removed fallback.
    mockECSClient.on(ListTasksCommand)
      .resolvesOnce({ taskArns: [] })
      .resolves({ taskArns: ['arn:aws:ecs:us-east-1:123456789012:task/my-cluster/clusterwidetask01'] });
    mockECSClient.on(DescribeTasksCommand).resolves({
      tasks: [{ stoppedReason: 'Essential container exited', containers: [] }],
    });
    mockECSClient.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: { containerDefinitions: [] },
    });

    const result = await investigateResource(ecsServiceError('my-cluster/my-service'), sdk, debug);

    // The service-scoped call must have happened first...
    expect(mockECSClient).toHaveReceivedCommandWith(ListTasksCommand, {
      cluster: 'my-cluster',
      serviceName: 'my-service',
      desiredStatus: 'STOPPED',
    });
    // ...and a cluster-wide fallback call (no serviceName) must have followed.
    expect(mockECSClient).toHaveReceivedCommandTimes(ListTasksCommand, 2);
    // ...resolving to the cluster-wide task.
    expect(mockECSClient).toHaveReceivedCommandWith(DescribeTasksCommand, {
      cluster: 'my-cluster',
      tasks: ['clusterwidetask01'],
    });
    expect(result.find(c => c.source === 'ECS Stopped Tasks')).toBeDefined();
  });

  test('falls back to a service failure event when no stopped tasks are retained', async () => {
    // The failure mode from the live runs: the only filter-matching event has no task ID,
    // and listTasks returns nothing (tasks aged out / drained). We should still surface the
    // service event rather than an empty block.
    mockECSClient.on(DescribeServicesCommand).resolves({
      services: [{
        serviceName: 'my-service',
        taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:5',
        events: [
          { message: '(service my-service) deployment failed: tasks failed to start.' },
        ],
      }],
    });
    mockECSClient.on(ListTasksCommand).resolves({ taskArns: [] });
    mockECSClient.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: { containerDefinitions: [] },
    });

    const result = await investigateResource(ecsServiceError('my-cluster/my-service'), sdk, debug);

    const stopped = result.find(c => c.source === 'ECS Stopped Tasks');
    expect(stopped).toBeDefined();
    expect(stopped!.messages).toEqual(['(service my-service) deployment failed: tasks failed to start.']);
    // describeTasks must not be called when there are no task IDs.
    expect(mockECSClient).not.toHaveReceivedCommand(DescribeTasksCommand);
  });

  test('falls back to the no-log-config message when task def has no awslogs driver', async () => {
    mockECSClient.on(DescribeServicesCommand).resolves({
      services: [{
        taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:5',
        events: [],
      }],
    });
    mockECSClient.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: {
        containerDefinitions: [
          { name: 'app', image: 'public.ecr.aws/example/app:latest' },
        ],
      },
    });

    const result = await investigateResource(
      ecsServiceError('my-cluster/my-service'),
      sdk,
      debug,
    );

    const cwl = result.find(c => c.source === 'CloudWatch Logs');
    expect(cwl).toBeDefined();
    expect(cwl!.messages[0]).toMatch(/No CloudWatch Logs configuration/);
  });

  test('caps logs at MAX_LOG_LINES and prepends an omission marker', async () => {
    mockECSClient.on(DescribeServicesCommand).resolves({
      services: [{
        taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:5',
        events: [],
      }],
    });
    mockECSClient.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: {
        containerDefinitions: [{
          name: 'app',
          image: 'app:latest',
          logConfiguration: {
            logDriver: 'awslogs',
            options: { 'awslogs-group': '/ecs/my-task' },
          },
        }],
      },
    });
    // 75 events -> expect 50 retained + 1 omission marker = 51 messages
    const events = Array.from({ length: 75 }, (_, i) => ({ message: `line ${i}` }));
    mockCloudWatchClient.on(FilterLogEventsCommand).resolves({ events });

    const result = await investigateResource(
      ecsServiceError('my-cluster/my-service'),
      sdk,
      debug,
    );

    const logs = result.find(c => c.source.startsWith('CloudWatch Logs:'));
    expect(logs).toBeDefined();
    expect(logs!.messages).toHaveLength(51);
    expect(logs!.messages[0]).toMatch(/^\.\.\. \(25 earlier lines omitted\)$/);
    expect(logs!.messages[1]).toBe('line 25');
    expect(logs!.messages[50]).toBe('line 74');
  });

  test('does not emit an omission marker when within the cap', async () => {
    mockECSClient.on(DescribeServicesCommand).resolves({
      services: [{
        taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:5',
        events: [],
      }],
    });
    mockECSClient.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: {
        containerDefinitions: [{
          name: 'app',
          image: 'app:latest',
          logConfiguration: {
            logDriver: 'awslogs',
            options: { 'awslogs-group': '/ecs/my-task' },
          },
        }],
      },
    });
    mockCloudWatchClient.on(FilterLogEventsCommand).resolves({
      events: [{ message: 'only line' }],
    });

    const result = await investigateResource(
      ecsServiceError('my-cluster/my-service'),
      sdk,
      debug,
    );
    const logs = result.find(c => c.source.startsWith('CloudWatch Logs:'));
    expect(logs!.messages).toEqual(['only line']);
  });

  test('emits a no-logs-found message when filterLogEvents returns nothing', async () => {
    mockECSClient.on(DescribeServicesCommand).resolves({
      services: [{
        taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:5',
        events: [],
      }],
    });
    mockECSClient.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: {
        containerDefinitions: [{
          name: 'app',
          image: 'app:latest',
          logConfiguration: {
            logDriver: 'awslogs',
            options: { 'awslogs-group': '/ecs/my-task' },
          },
        }],
      },
    });
    mockCloudWatchClient.on(FilterLogEventsCommand).resolves({ events: [] });

    const result = await investigateResource(
      ecsServiceError('my-cluster/my-service'),
      sdk,
      debug,
    );
    const cwl = result.find(c => c.source === 'CloudWatch Logs');
    expect(cwl?.messages[0]).toMatch(/No CloudWatch Logs found/);
  });
});

describe('serviceTokenReferencedLogicalId', () => {
  test('extracts the logical ID from an Fn::GetAtt', () => {
    expect(serviceTokenReferencedLogicalId({ 'Fn::GetAtt': ['MyFn', 'Arn'] })).toEqual('MyFn');
  });

  test('extracts the logical ID from a Ref', () => {
    expect(serviceTokenReferencedLogicalId({ Ref: 'MyFn' })).toEqual('MyFn');
  });

  test('returns undefined for a literal string', () => {
    expect(serviceTokenReferencedLogicalId('arn:aws:lambda:us-east-1:123456789012:function:my-fn')).toBeUndefined();
  });

  test('returns undefined for an unrecognized object', () => {
    expect(serviceTokenReferencedLogicalId({ 'Fn::Sub': 'x' })).toBeUndefined();
  });
});

describe('functionNameFromArnOrName', () => {
  test('parses the name from a function ARN', () => {
    expect(functionNameFromArnOrName('arn:aws:lambda:us-east-1:123456789012:function:my-fn')).toEqual('my-fn');
  });

  test('parses the name from a function ARN with version suffix', () => {
    expect(functionNameFromArnOrName('arn:aws:lambda:us-east-1:123456789012:function:my-fn:42')).toEqual('my-fn');
  });

  test('handles non-aws partitions', () => {
    expect(functionNameFromArnOrName('arn:aws-cn:lambda:cn-north-1:123456789012:function:my-fn')).toEqual('my-fn');
  });

  test('passes through a bare function name', () => {
    expect(functionNameFromArnOrName('my-fn')).toEqual('my-fn');
  });

  test('returns undefined for a non-lambda ARN', () => {
    expect(functionNameFromArnOrName('arn:aws:sns:us-east-1:123456789012:my-topic')).toBeUndefined();
  });
});

describe('extractLogStreamName', () => {
  test('extracts the cfn-response stream from the failure reason', () => {
    expect(extractLogStreamName('See the details in CloudWatch Log Stream: 2026/06/15/[$LATEST]abc123'))
      .toEqual('2026/06/15/[$LATEST]abc123');
  });

  test('returns undefined when no stream is present', () => {
    expect(extractLogStreamName('Some other failure reason')).toBeUndefined();
  });

  test('returns undefined for an undefined message', () => {
    expect(extractLogStreamName(undefined)).toBeUndefined();
  });
});

describe('identityMatches', () => {
  const SESSION_ARN = 'arn:aws:sts::123456789012:assumed-role/MyStack-CrHandlerRole-abc/MyStack-CrHandler-def';

  test('matches a single-segment key as a whole segment', () => {
    expect(identityMatches(SESSION_ARN, 'MyStack-CrHandler-def')).toBe(true);
    expect(identityMatches(SESSION_ARN, 'MyStack-CrHandlerRole-abc')).toBe(true);
  });

  test('does not match a key that is a prefix of a segment', () => {
    // The core guarantee: 'my-svc-1' must not claim 'my-svc-10'.
    expect(identityMatches('arn:aws:sts::123456789012:assumed-role/role/my-svc-10', 'my-svc-1')).toBe(false);
    expect(identityMatches(SESSION_ARN, 'MyStack-CrHandler')).toBe(false);
  });

  test('does not match a key that is a suffix of a segment', () => {
    expect(identityMatches('arn:aws:sts::123456789012:assumed-role/role/prod-my-svc', 'my-svc')).toBe(false);
  });

  test('matches whole strings exactly', () => {
    expect(identityMatches('my-function-name', 'my-function-name')).toBe(true);
  });

  test('matches a segment at the start and end of the haystack', () => {
    expect(identityMatches('my-svc/suffix', 'my-svc')).toBe(true);
    expect(identityMatches('prefix/my-svc', 'my-svc')).toBe(true);
  });

  test('matches a multi-segment key when delimiter-bounded', () => {
    const roleArn = 'arn:aws:iam::123456789012:role/service-role/my-role';
    expect(identityMatches(roleArn, 'role/service-role/my-role')).toBe(true);
    expect(identityMatches(roleArn, 'service-role/my-rol')).toBe(false);
  });

  test('matches a multi-segment key at a later occurrence when the first is unbounded', () => {
    // First occurrence of 'b/c' inside 'ab/c' is not segment-bounded; the second is.
    expect(identityMatches('x/ab/c/y/b/c', 'b/c')).toBe(true);
  });

  test('does not match an empty or absent key occurrence', () => {
    expect(identityMatches('a/b/c', 'd')).toBe(false);
  });
});

describe('nameSegment', () => {
  test('extracts the trailing segment of a role ARN', () => {
    expect(nameSegment('arn:aws:iam::123456789012:role/my-role')).toEqual('my-role');
  });

  test('extracts the trailing segment of a path-shaped ID', () => {
    expect(nameSegment('cluster-name/service-name')).toEqual('service-name');
  });

  test('returns undefined for a value without a path', () => {
    expect(nameSegment('my-function-name')).toBeUndefined();
  });

  test('returns undefined for a trailing slash', () => {
    expect(nameSegment('some/path/')).toBeUndefined();
  });
});

describe('assumedRoleSessionName', () => {
  test('extracts the session name from an assumed-role ARN', () => {
    expect(assumedRoleSessionName('arn:aws:sts::123456789012:assumed-role/my-role/my-session'))
      .toEqual('my-session');
  });

  test('keeps session names that contain slashes intact', () => {
    expect(assumedRoleSessionName('arn:aws:sts::123456789012:assumed-role/my-role/a/b'))
      .toEqual('a/b');
  });

  test('returns undefined for a plain role ARN', () => {
    expect(assumedRoleSessionName('arn:aws:iam::123456789012:role/my-role')).toBeUndefined();
  });

  test('returns undefined for a non-ARN string', () => {
    expect(assumedRoleSessionName('my-function-name')).toBeUndefined();
  });
});

describe('parseLambdaLogEvents', () => {
  const msgs = (events: Array<{ message?: string }>) => parseLambdaLogEvents(events);

  test('strips the timestamp/requestId prefix from text-format lines and aligns the level', () => {
    expect(msgs([
      { message: '2026-06-19T18:25:11.112Z\treq-1\tERROR\tBoom: it failed' },
      { message: '2026-06-19T18:25:11.113Z\treq-1\tINFO\tall good' },
    ])).toEqual([
      'ERROR Boom: it failed',
      'INFO  all good',
    ]);
  });

  test('drops Lambda platform boilerplate (INIT_START/START/END/REPORT)', () => {
    expect(msgs([
      { message: 'INIT_START Runtime Version: nodejs:20.v101' },
      { message: 'START RequestId: req-1 Version: $LATEST' },
      { message: '2026-06-19T18:25:11.112Z\treq-1\tERROR\tthe real error' },
      { message: 'END RequestId: req-1' },
      { message: 'REPORT RequestId: req-1\tDuration: 1009 ms' },
    ])).toEqual(['ERROR the real error']);
  });

  test('keeps INFO-level application output (failure detail often rides in INFO)', () => {
    // The cfn-response failure body is logged at INFO; it must survive.
    const out = msgs([
      { message: '2026-06-19T18:25:11.113Z\treq-1\tINFO\tResponse body: {"Status":"FAILED","Data":{"error":"x"}}' },
    ]);
    expect(out).toEqual(['INFO  Response body: {"Status":"FAILED","Data":{"error":"x"}}']);
  });

  test('normalizes JSON-format events to LEVEL + message', () => {
    expect(msgs([
      { message: '{"timestamp":"2026-06-19T18:25:11.112Z","level":"ERROR","requestId":"req-1","message":"Boom: it failed"}' },
      { message: '{"level":"INFO","message":"all good"}' },
    ])).toEqual([
      'ERROR Boom: it failed',
      'INFO  all good',
    ]);
  });

  test('drops JSON platform events', () => {
    expect(msgs([
      { message: '{"time":"2026-06-19T18:25:11Z","type":"platform.report","record":{"metrics":{"maxMemoryUsedMB":74}}}' },
      { message: '{"level":"ERROR","message":"kept"}' },
    ])).toEqual(['ERROR kept']);
  });

  test('renders a JSON error envelope with stack trace', () => {
    expect(msgs([
      { message: '{"level":"ERROR","errorMessage":"KeyError: foo","stackTrace":["  at a","  at b"]}' },
    ])).toEqual(['ERROR KeyError: foo\n  at a\n  at b']);
  });

  test('passes through malformed JSON verbatim', () => {
    expect(msgs([{ message: '{not valid json' }])).toEqual(['{not valid json']);
  });

  test('passes through plain/unstructured lines verbatim', () => {
    expect(msgs([
      { message: 'a plain stdout line with no structure' },
      { message: '  at SomeStackFrame (file.js:1:2)' },
    ])).toEqual([
      'a plain stdout line with no structure',
      '  at SomeStackFrame (file.js:1:2)',
    ]);
  });

  test('handles a mixed batch of text, JSON, platform, and plain lines', () => {
    expect(msgs([
      { message: 'START RequestId: req-1 Version: $LATEST' },
      { message: '2026-06-19T18:25:11.112Z\treq-1\tWARN\ttext line' },
      { message: '{"level":"ERROR","message":"json line"}' },
      { message: 'bare line' },
    ])).toEqual([
      'WARN  text line',
      'ERROR json line',
      'bare line',
    ]);
  });

  test('skips events with no message', () => {
    expect(msgs([{ message: undefined }, { message: 'kept' }])).toEqual(['kept']);
  });
});

describe('investigateResource for custom resources', () => {
  const STACK_ARN = 'arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/abc';

  function customResourceError(overrides: Partial<ResourceError> = {}): ResourceError {
    return {
      stackArn: STACK_ARN,
      parentStackLogicalIds: [],
      logicalId: 'MyCustomResource',
      resourceType: 'Custom::MyThing',
      message: 'See the details in CloudWatch Log Stream: 2026/06/15/[$LATEST]streamabc',
      ...overrides,
    };
  }

  function templateWith(serviceToken: any): string {
    return JSON.stringify({
      Resources: {
        MyCustomResource: { Type: 'Custom::MyThing', Properties: { ServiceToken: serviceToken } },
      },
    });
  }

  test('reads the configured log group from the template without a live function call (rollback-proof)', async () => {
    // ServiceToken is a GetAtt to a function defined in this stack whose LoggingConfig.LogGroup
    // is a literal. The function may be deleted by rollback, so we must NOT need getFunctionConfiguration.
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: JSON.stringify({
        Resources: {
          MyCustomResource: { Type: 'Custom::MyThing', Properties: { ServiceToken: { 'Fn::GetAtt': ['ProviderFn', 'Arn'] } } },
          ProviderFn: { Type: 'AWS::Lambda::Function', Properties: { LoggingConfig: { LogGroup: '/custom/grp' } } },
        },
      }),
    });
    mockCloudFormationClient.on(DescribeStackResourcesCommand).resolves({
      StackResources: [{ LogicalResourceId: 'ProviderFn', PhysicalResourceId: 'arn:aws:lambda:us-east-1:123456789012:function:provider-fn' } as any],
    });
    // Convention group empty; the configured group (from template) has the logs.
    mockCloudWatchClient.on(FilterLogEventsCommand, { logGroupName: '/aws/lambda/provider-fn' }).resolves({ events: [] });
    mockCloudWatchClient.on(FilterLogEventsCommand, { logGroupName: '/custom/grp' }).resolves({ events: [{ message: 'configured group line' }] });

    const result = await investigateResource(customResourceError(), sdk, debug);

    // The whole point: log group came from the template, so no live function call was needed.
    expect(mockLambdaClient).not.toHaveReceivedCommand(GetFunctionConfigurationCommand);
    const logs = result.find(c => c.source === 'Custom Resource Lambda Logs');
    expect(logs!.messages).toEqual(['Logs from /custom/grp:', 'configured group line']);
  });

  test('resolves a template LoggingConfig.LogGroup given as a Ref to a log-group resource', async () => {
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: JSON.stringify({
        Resources: {
          MyCustomResource: { Type: 'Custom::MyThing', Properties: { ServiceToken: { 'Fn::GetAtt': ['ProviderFn', 'Arn'] } } },
          ProviderFn: { Type: 'AWS::Lambda::Function', Properties: { LoggingConfig: { LogGroup: { Ref: 'FnLogs' } } } },
          FnLogs: { Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: '/explicit/group/name' } },
        },
      }),
    });
    mockCloudFormationClient.on(DescribeStackResourcesCommand).resolves({
      StackResources: [{ LogicalResourceId: 'ProviderFn', PhysicalResourceId: 'arn:aws:lambda:us-east-1:123456789012:function:provider-fn' } as any],
    });
    mockCloudWatchClient.on(FilterLogEventsCommand, { logGroupName: '/aws/lambda/provider-fn' }).resolves({ events: [] });
    mockCloudWatchClient.on(FilterLogEventsCommand, { logGroupName: '/explicit/group/name' }).resolves({ events: [{ message: 'x' }] });

    const result = await investigateResource(customResourceError(), sdk, debug);

    expect(mockLambdaClient).not.toHaveReceivedCommand(GetFunctionConfigurationCommand);
    const logs = result.find(c => c.source === 'Custom Resource Lambda Logs');
    expect(logs!.messages[0]).toEqual('Logs from /explicit/group/name:');
  });

  test('resolves a Ref log group with no explicit name via describeStackResources (CDK default)', async () => {
    // The common CDK case: the AWS::Logs::LogGroup has no LogGroupName, so CloudFormation
    // generates the physical name. We must resolve it via describeStackResources (which still
    // returns the RETAINed group after rollback), not give up.
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: JSON.stringify({
        Resources: {
          MyCustomResource: { Type: 'Custom::MyThing', Properties: { ServiceToken: { 'Fn::GetAtt': ['ProviderFn', 'Arn'] } } },
          ProviderFn: { Type: 'AWS::Lambda::Function', Properties: { LoggingConfig: { LogGroup: { Ref: 'FnLogs' } } } },
          FnLogs: { Type: 'AWS::Logs::LogGroup', Properties: { RetentionInDays: 7 } }, // no LogGroupName
        },
      }),
    });
    // ServiceToken's ProviderFn and the log group's FnLogs are resolved by logical ID.
    mockCloudFormationClient.on(DescribeStackResourcesCommand, { StackName: STACK_ARN, LogicalResourceId: 'ProviderFn' })
      .resolves({ StackResources: [{ LogicalResourceId: 'ProviderFn', PhysicalResourceId: 'arn:aws:lambda:us-east-1:123456789012:function:provider-fn' } as any] });
    mockCloudFormationClient.on(DescribeStackResourcesCommand, { StackName: STACK_ARN, LogicalResourceId: 'FnLogs' })
      .resolves({ StackResources: [{ LogicalResourceId: 'FnLogs', PhysicalResourceId: 'MyStack-FnLogs-GENERATED123' } as any] });
    mockCloudWatchClient.on(FilterLogEventsCommand, { logGroupName: '/aws/lambda/provider-fn' }).resolves({ events: [] });
    mockCloudWatchClient.on(FilterLogEventsCommand, { logGroupName: 'MyStack-FnLogs-GENERATED123' }).resolves({ events: [{ message: 'advanced logging line' }] });

    const result = await investigateResource(customResourceError(), sdk, debug);

    expect(mockLambdaClient).not.toHaveReceivedCommand(GetFunctionConfigurationCommand);
    const logs = result.find(c => c.source === 'Custom Resource Lambda Logs');
    expect(logs!.messages).toEqual(['Logs from MyStack-FnLogs-GENERATED123:', 'advanced logging line']);
  });

  test('resolves a literal-ARN ServiceToken and fetches the failing stream from the convention group', async () => {
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: templateWith('arn:aws:lambda:us-east-1:123456789012:function:my-cr-fn'),
    });
    mockCloudWatchClient.on(FilterLogEventsCommand).resolves({ events: [{ message: 'Traceback: KeyError "Foo"' }] });

    const result = await investigateResource(customResourceError(), sdk, debug);

    expect(mockCloudWatchClient).toHaveReceivedCommandWith(FilterLogEventsCommand, {
      logGroupName: '/aws/lambda/my-cr-fn',
      logStreamNames: ['2026/06/15/[$LATEST]streamabc'],
    });
    // Convention group had events, so we must NOT have called getFunctionConfiguration.
    expect(mockLambdaClient).not.toHaveReceivedCommand(GetFunctionConfigurationCommand);
    const logs = result.find(c => c.source === 'Custom Resource Lambda Logs');
    expect(logs).toBeDefined();
    expect(logs!.messages).toEqual(['Logs from /aws/lambda/my-cr-fn:', 'Traceback: KeyError "Foo"']);
    expect(logs!.linkLabel).toEqual('Logs');
    expect(logs!.link).toContain('logsV2:log-groups');
  });

  test('resolves an Fn::GetAtt ServiceToken via describeStackResources', async () => {
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: templateWith({ 'Fn::GetAtt': ['ProviderFn', 'Arn'] }),
    });
    mockCloudFormationClient.on(DescribeStackResourcesCommand).resolves({
      StackResources: [{
        LogicalResourceId: 'ProviderFn',
        PhysicalResourceId: 'arn:aws:lambda:us-east-1:123456789012:function:provider-fn',
      } as any],
    });
    mockCloudWatchClient.on(FilterLogEventsCommand).resolves({ events: [{ message: 'log line' }] });

    const result = await investigateResource(customResourceError(), sdk, debug);

    expect(mockCloudFormationClient).toHaveReceivedCommandWith(DescribeStackResourcesCommand, {
      StackName: STACK_ARN,
      LogicalResourceId: 'ProviderFn',
    });
    expect(mockCloudWatchClient).toHaveReceivedCommandWith(FilterLogEventsCommand, { logGroupName: '/aws/lambda/provider-fn' });
    expect(result.find(c => c.source === 'Custom Resource Lambda Logs')).toBeDefined();
  });

  test('resolves a Ref ServiceToken via describeStackResources', async () => {
    mockCloudFormationClient.on(GetTemplateCommand).resolves({ TemplateBody: templateWith({ Ref: 'ProviderFn' }) });
    mockCloudFormationClient.on(DescribeStackResourcesCommand).resolves({
      StackResources: [{
        LogicalResourceId: 'ProviderFn',
        PhysicalResourceId: 'arn:aws:lambda:us-east-1:123456789012:function:ref-fn',
      } as any],
    });
    mockCloudWatchClient.on(FilterLogEventsCommand).resolves({ events: [{ message: 'x' }] });

    await investigateResource(customResourceError(), sdk, debug);

    expect(mockCloudFormationClient).toHaveReceivedCommandWith(DescribeStackResourcesCommand, {
      StackName: STACK_ARN,
      LogicalResourceId: 'ProviderFn',
    });
  });

  test('falls back to the LoggingConfig log group when the convention group is empty', async () => {
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: templateWith('arn:aws:lambda:us-east-1:123456789012:function:my-cr-fn'),
    });
    // Convention group empty; custom group has the logs.
    mockCloudWatchClient.on(FilterLogEventsCommand, { logGroupName: '/aws/lambda/my-cr-fn' }).resolves({ events: [] });
    mockCloudWatchClient.on(FilterLogEventsCommand, { logGroupName: '/custom/log/group' }).resolves({ events: [{ message: 'custom group line' }] });
    mockLambdaClient.on(GetFunctionConfigurationCommand).resolves({ LoggingConfig: { LogGroup: '/custom/log/group' } });

    const result = await investigateResource(customResourceError(), sdk, debug);

    expect(mockLambdaClient).toHaveReceivedCommandWith(GetFunctionConfigurationCommand, { FunctionName: 'my-cr-fn' });
    const logs = result.find(c => c.source === 'Custom Resource Lambda Logs');
    expect(logs!.messages).toEqual(['Logs from /custom/log/group:', 'custom group line']);
    expect(logs!.link).toContain('$252Fcustom'); // double-encoded /custom...
  });

  test('bounds the log query to a window around the failure timestamp', async () => {
    const failureTime = new Date('2026-06-15T12:00:00.000Z');
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: templateWith('arn:aws:lambda:us-east-1:123456789012:function:my-cr-fn'),
    });
    mockCloudWatchClient.on(FilterLogEventsCommand).resolves({ events: [{ message: 'rollback failure' }] });

    await investigateResource(customResourceError({ timestamp: failureTime }), sdk, debug);

    expect(mockCloudWatchClient).toHaveReceivedCommandWith(FilterLogEventsCommand, {
      logGroupName: '/aws/lambda/my-cr-fn',
      startTime: failureTime.valueOf() - 2 * 60 * 1000,
      endTime: failureTime.valueOf() + 15 * 60 * 1000,
    });
  });

  test('handles AWS::CloudFormation::CustomResource type', async () => {
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: JSON.stringify({
        Resources: {
          MyCustomResource: {
            Type: 'AWS::CloudFormation::CustomResource',
            Properties: { ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:my-cr-fn' },
          },
        },
      }),
    });
    mockCloudWatchClient.on(FilterLogEventsCommand).resolves({ events: [{ message: 'x' }] });

    const result = await investigateResource(
      customResourceError({ resourceType: 'AWS::CloudFormation::CustomResource' }), sdk, debug,
    );
    expect(result.find(c => c.source === 'Custom Resource Lambda Logs')).toBeDefined();
  });

  test('emits a no-logs context when no events are found in either group', async () => {
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: templateWith('arn:aws:lambda:us-east-1:123456789012:function:my-cr-fn'),
    });
    mockCloudWatchClient.on(FilterLogEventsCommand).resolves({ events: [] });
    mockLambdaClient.on(GetFunctionConfigurationCommand).resolves({}); // no custom group

    const result = await investigateResource(customResourceError(), sdk, debug);
    const logs = result.find(c => c.source === 'Custom Resource Lambda Logs');
    expect(logs!.messages.join('\n')).toMatch(/No log events found/);
  });

  test('returns empty when the resource has no ServiceToken', async () => {
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: JSON.stringify({ Resources: { MyCustomResource: { Type: 'Custom::MyThing', Properties: {} } } }),
    });

    const result = await investigateResource(customResourceError(), sdk, debug);
    expect(result).toEqual([]);
  });

  test('returns empty when the ServiceToken is not a Lambda', async () => {
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: templateWith('arn:aws:sns:us-east-1:123456789012:my-topic'),
    });

    const result = await investigateResource(customResourceError(), sdk, debug);
    expect(result).toEqual([]);
  });

  test('returns empty when no logical ID is available', async () => {
    const result = await investigateResource(customResourceError({ logicalId: undefined }), sdk, debug);
    expect(result).toEqual([]);
  });

  test('returns empty when an intrinsic ServiceToken references a non-Lambda resource', async () => {
    // ServiceToken is a Ref to a non-Lambda resource whose physical ID is a BARE NAME (not an
    // ARN) — e.g. some resources return their name as the physical ID. Without the
    // ResourceType check, functionNameFromArnOrName would accept the bare name and we'd query
    // /aws/lambda/<name>. The type gate is what stops that.
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: templateWith({ Ref: 'MyOtherResource' }),
    });
    mockCloudFormationClient.on(DescribeStackResourcesCommand).resolves({
      StackResources: [{
        LogicalResourceId: 'MyOtherResource',
        ResourceType: 'AWS::SNS::Topic',
        PhysicalResourceId: 'MyStack-MyOtherResource-ABC123', // bare name, not an ARN
      } as any],
    });

    const result = await investigateResource(customResourceError(), sdk, debug);

    expect(result).toEqual([]);
    // Must not have attempted a /aws/lambda/... lookup for the non-Lambda resource.
    expect(mockCloudWatchClient).not.toHaveReceivedCommand(FilterLogEventsCommand);
  });

  test('reports a fetch error distinctly from an empty log group', async () => {
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: templateWith('arn:aws:lambda:us-east-1:123456789012:function:my-cr-fn'),
    });
    // filterLogEvents fails (e.g. AccessDenied) rather than returning empty.
    mockCloudWatchClient.on(FilterLogEventsCommand).rejects(new Error('AccessDeniedException'));
    mockLambdaClient.on(GetFunctionConfigurationCommand).resolves({}); // no custom group

    const result = await investigateResource(customResourceError(), sdk, debug);
    const logs = result.find(c => c.source === 'Custom Resource Lambda Logs');
    const text = logs!.messages.join('\n');
    expect(text).toMatch(/Could not fetch logs/);
    expect(text).not.toMatch(/No log events found/);
  });

  test('resolves a YAML string-form Fn::GetAtt ServiceToken', async () => {
    // YAML `!GetAtt ProviderFn.Arn` deserializes to { 'Fn::GetAtt': 'ProviderFn.Arn' } (a string).
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: templateWith({ 'Fn::GetAtt': 'ProviderFn.Arn' }),
    });
    mockCloudFormationClient.on(DescribeStackResourcesCommand).resolves({
      StackResources: [{
        LogicalResourceId: 'ProviderFn',
        PhysicalResourceId: 'arn:aws:lambda:us-east-1:123456789012:function:yaml-fn',
      } as any],
    });
    mockCloudWatchClient.on(FilterLogEventsCommand).resolves({ events: [{ message: 'x' }] });

    await investigateResource(customResourceError(), sdk, debug);

    expect(mockCloudFormationClient).toHaveReceivedCommandWith(DescribeStackResourcesCommand, {
      StackName: STACK_ARN,
      LogicalResourceId: 'ProviderFn',
    });
    expect(mockCloudWatchClient).toHaveReceivedCommandWith(FilterLogEventsCommand, { logGroupName: '/aws/lambda/yaml-fn' });
  });

  test('falls back to a group-wide scan when the targeted stream has no events (stale stream)', async () => {
    // Stream-scoped query returns nothing (e.g. stale create-time stream on an update failure);
    // the un-scoped group scan finds the actual failing invocation's logs.
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: templateWith('arn:aws:lambda:us-east-1:123456789012:function:my-cr-fn'),
    });
    // Call 1 (targeted stream) returns nothing; call 2 (un-scoped group scan) finds the logs.
    // Sequenced with resolvesOnce so the fallback path is genuinely required (partial input
    // matchers would overlap and let the targeted call satisfy the group-scan mock).
    mockCloudWatchClient.on(FilterLogEventsCommand)
      .resolvesOnce({ events: [] })
      .resolves({ events: [{ message: 'actual failure on update' }] });

    const result = await investigateResource(customResourceError(), sdk, debug);

    const logs = result.find(c => c.source === 'Custom Resource Lambda Logs');
    expect(logs!.messages).toEqual(['Logs from /aws/lambda/my-cr-fn:', 'actual failure on update']);
    // It must have tried the targeted stream first...
    expect(mockCloudWatchClient).toHaveReceivedNthCommandWith(1, FilterLogEventsCommand, {
      logGroupName: '/aws/lambda/my-cr-fn',
      logStreamNames: ['2026/06/15/[$LATEST]streamabc'],
    });
    // ...then a second, un-scoped group scan (no logStreamNames).
    expect(mockCloudWatchClient).toHaveReceivedCommandTimes(FilterLogEventsCommand, 2);
    const secondCall = mockCloudWatchClient.commandCalls(FilterLogEventsCommand)[1].args[0].input as any;
    expect(secondCall.logStreamNames).toBeUndefined();
  });

  test('links to the configured log group (not the convention group) when both are empty', async () => {
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: templateWith('arn:aws:lambda:us-east-1:123456789012:function:my-cr-fn'),
    });
    // Every filterLogEvents (convention + configured, targeted + scan) returns empty.
    mockCloudWatchClient.on(FilterLogEventsCommand).resolves({ events: [] });
    mockLambdaClient.on(GetFunctionConfigurationCommand).resolves({ LoggingConfig: { LogGroup: '/custom/log/group' } });

    const result = await investigateResource(customResourceError(), sdk, debug);

    const logs = result.find(c => c.source === 'Custom Resource Lambda Logs');
    expect(logs!.messages.join('\n')).toMatch(/No log events found/);
    // The header and link must point at the configured group, where the function actually logs.
    expect(logs!.messages[0]).toEqual('Logs from /custom/log/group:');
    expect(logs!.link).toContain('$252Fcustom$252Flog$252Fgroup');
    expect(logs!.link).not.toContain('my-cr-fn');
  });
});
