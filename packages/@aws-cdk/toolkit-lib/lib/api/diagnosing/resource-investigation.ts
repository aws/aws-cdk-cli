import type { AdditionalDiagnosticContext } from '../../actions/diagnose';
import type { ICloudWatchLogsClient, IECSClient, SDK } from '../aws-auth/sdk';
import type { ResourceError } from '../stack-events/resource-errors';

/**
 * Investigate a failed resource using AWS service APIs to gather additional root cause context.
 *
 * Returns additional diagnostic context (e.g. log lines) or an empty array if
 * investigation is not possible or yields no results for this resource type.
 */
export async function investigateResource(
  err: ResourceError,
  sdk: SDK,
  debug: (msg: string) => Promise<void>,
): Promise<AdditionalDiagnosticContext[]> {
  switch (err.resourceType) {
    case 'AWS::ECS::Service':
      return investigateEcsService(err, sdk, debug);
    default:
      return [];
  }
}

async function investigateEcsService(
  err: ResourceError,
  sdk: SDK,
  debug: (msg: string) => Promise<void>,
): Promise<AdditionalDiagnosticContext[]> {
  const physicalId = err.physicalId;
  if (!physicalId) {
    await debug('ECS investigation: no physical ID available');
    return [];
  }

  const { clusterArn, serviceName } = parseEcsServiceIdentifier(physicalId);
  if (!serviceName) {
    await debug(`ECS investigation: could not parse service identifier from "${physicalId}"`);
    return [];
  }

  const ecs = sdk.ecs();
  const cwl = sdk.cloudWatchLogs();

  const service = await describeService(ecs, clusterArn, serviceName, debug);
  if (!service) {
    return [];
  }

  const results: AdditionalDiagnosticContext[] = [];

  const stoppedTaskContext = await getStoppedTaskReasons(ecs, clusterArn, service, debug);
  if (stoppedTaskContext) {
    results.push(stoppedTaskContext);
  }

  const taskDefinitionArn = service.taskDefinition;
  if (!taskDefinitionArn) {
    return results;
  }

  const logConfigs = await getLogConfigsFromTaskDefinition(ecs, taskDefinitionArn, debug);
  if (logConfigs.length === 0) {
    return results;
  }

  // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
  const logResults = await Promise.all(logConfigs.map(cfg => fetchRecentLogs(cwl, cfg, debug)));
  for (const context of logResults) {
    if (context) {
      results.push(context);
    }
  }

  return results;
}

function parseEcsServiceIdentifier(physicalId: string): { clusterArn?: string; serviceName?: string } {
  // ARN format: arn:aws:ecs:region:account:service/cluster-name/service-name
  const arnMatch = physicalId.match(/arn:.*:ecs:.*:.*:service\/([^/]+)\/(.+)/);
  if (arnMatch) {
    return { clusterArn: arnMatch[1], serviceName: arnMatch[2] };
  }

  const parts = physicalId.split('/');
  if (parts.length === 2) {
    return { clusterArn: parts[0], serviceName: parts[1] };
  }

  return { serviceName: physicalId };
}

async function describeService(
  ecs: IECSClient,
  cluster: string | undefined,
  serviceName: string,
  debug: (msg: string) => Promise<void>,
) {
  try {
    const resp = await ecs.describeServices({ cluster, services: [serviceName] });
    const service = resp.services?.[0];
    if (!service) {
      await debug(`ECS investigation: service "${serviceName}" not found`);
    }
    return service;
  } catch (e: any) {
    await debug(`ECS investigation: failed to describe service: ${e.message}`);
    return undefined;
  }
}

async function getStoppedTaskReasons(
  ecs: IECSClient,
  cluster: string | undefined,
  service: { events?: Array<{ message?: string }>; [key: string]: any },
  debug: (msg: string) => Promise<void>,
): Promise<AdditionalDiagnosticContext | undefined> {
  try {
    const failureEvents = (service.events ?? [])
      .filter(e => e.message?.includes('stopped') || e.message?.includes('failed'))
      .slice(0, 5);

    if (failureEvents.length === 0) {
      return undefined;
    }

    const taskIds = (service.events ?? [])
      .map(e => {
        const match = e.message?.match(/task ([a-f0-9-]+)/);
        return match ? match[1] : undefined;
      })
      .filter((id): id is string => id != null)
      .slice(0, 3);

    const messages: string[] = [];

    if (taskIds.length > 0) {
      const tasksResp = await ecs.describeTasks({ cluster, tasks: taskIds });
      for (const task of tasksResp.tasks ?? []) {
        if (task.stoppedReason) {
          messages.push(`Task stopped: ${task.stoppedReason}`);
        }
        for (const container of task.containers ?? []) {
          if (container.reason) {
            messages.push(`Container "${container.name}": ${container.reason}`);
          }
        }
      }
    }

    if (messages.length === 0) {
      for (const event of failureEvents) {
        if (event.message) {
          messages.push(event.message);
        }
      }
    }

    if (messages.length === 0) {
      return undefined;
    }

    return { source: 'ECS Stopped Tasks', messages };
  } catch (e: any) {
    await debug(`ECS investigation: failed to get stopped task reasons: ${e.message}`);
    return undefined;
  }
}

interface AwsLogsConfig {
  logGroup: string;
  streamPrefix?: string;
  containerName?: string;
}

async function getLogConfigsFromTaskDefinition(
  ecs: IECSClient,
  taskDefinitionArn: string,
  debug: (msg: string) => Promise<void>,
): Promise<AwsLogsConfig[]> {
  try {
    const resp = await ecs.describeTaskDefinition({ taskDefinition: taskDefinitionArn });
    const containers = resp.taskDefinition?.containerDefinitions ?? [];
    const configs: AwsLogsConfig[] = [];
    for (const container of containers) {
      const logConfig = container.logConfiguration;
      if (logConfig?.logDriver === 'awslogs') {
        const logGroup = logConfig.options?.['awslogs-group'];
        if (logGroup) {
          configs.push({
            logGroup,
            streamPrefix: logConfig.options?.['awslogs-stream-prefix'],
            containerName: container.name,
          });
        }
      }
    }
    return configs;
  } catch (e: any) {
    await debug(`ECS investigation: failed to describe task definition: ${e.message}`);
    return [];
  }
}

async function fetchRecentLogs(
  cwl: ICloudWatchLogsClient,
  logConfig: AwsLogsConfig,
  debug: (msg: string) => Promise<void>,
): Promise<AdditionalDiagnosticContext | undefined> {
  try {
    const startTime = Date.now() - 30 * 60 * 1000;

    const resp = await cwl.filterLogEvents({
      logGroupName: logConfig.logGroup,
      startTime,
      limit: 20,
      ...(logConfig.streamPrefix ? { logStreamNamePrefix: logConfig.streamPrefix } : {}),
    });

    const events = resp.events ?? [];
    if (events.length === 0) {
      await debug(`ECS investigation: no recent log events in ${logConfig.logGroup}`);
      return undefined;
    }

    const messages = events
      .map(e => e.message?.trimEnd())
      .filter((m): m is string => m != null);

    const source = logConfig.containerName
      ? `CloudWatch Logs: ${logConfig.logGroup} (container: ${logConfig.containerName})`
      : `CloudWatch Logs: ${logConfig.logGroup}`;

    return { source, messages };
  } catch (e: any) {
    await debug(`ECS investigation: failed to fetch logs from ${logConfig.logGroup}: ${e.message}`);
    return undefined;
  }
}
