import { FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import {
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  ListTasksCommand,
} from '@aws-sdk/client-ecs';
import { investigateResource, parseEcsServiceIdentifier } from '../../../lib/api/diagnosing/resource-investigation';
import type { ResourceError } from '../../../lib/api/stack-events/resource-errors';
import {
  mockCloudWatchClient,
  mockECSClient,
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
