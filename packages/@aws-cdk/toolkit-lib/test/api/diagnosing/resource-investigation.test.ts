import { FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import {
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
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
        events: [
          { message: '(service my-service) (task abc12345-aaaa-bbbb-cccc-1111deadbeef) stopped' },
          { message: '(service my-service) has reached a steady state' },
        ],
      }],
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
      tasks: ['abc12345-aaaa-bbbb-cccc-1111deadbeef'],
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

    const images = result.find(c => c.source === 'Container Images');
    expect(images?.messages).toEqual(['app: public.ecr.aws/example/app:latest']);
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
    expect(cwl?.messages[0]).toMatch(/No application logs found/);
  });
});
