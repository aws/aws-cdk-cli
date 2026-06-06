import type { AdditionalDiagnosticContext } from '../../actions/diagnose';
import type { ICloudWatchLogsClient, IECSClient, SDK } from '../aws-auth/sdk';
import type { ResourceError } from '../stack-events/resource-errors';

/**
 * Maximum number of log lines included per CloudWatch Logs context block.
 *
 * The formatter renders the messages array verbatim, so this is the
 * single user-visible cap.
 */
const MAX_LOG_LINES = 50;

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

  const { cluster, serviceName } = parseEcsServiceIdentifier(physicalId);
  if (!serviceName) {
    await debug(`ECS investigation: could not parse service identifier from "${physicalId}"`);
    return [];
  }

  const region = sdk.currentRegion;
  const ecs = sdk.ecs();
  const cwl = sdk.cloudWatchLogs();

  const service = await describeService(ecs, cluster, serviceName, debug);
  if (!service) {
    return [];
  }

  const results: AdditionalDiagnosticContext[] = [];

  const stoppedTaskResult = await getStoppedTaskReasons(ecs, cluster, serviceName, region, service, debug);
  if (stoppedTaskResult.context) {
    results.push(stoppedTaskResult.context);
  }

  const taskDefinitionArn = service.taskDefinition;
  if (!taskDefinitionArn) {
    return results;
  }

  const taskDefInfo = await getTaskDefinitionInfo(ecs, taskDefinitionArn, debug);

  if (taskDefInfo && taskDefInfo.images.length > 0) {
    results.push({ source: 'Container Images', messages: taskDefInfo.images });
  }

  const logConfigs = taskDefInfo?.logConfigs ?? [];

  if (logConfigs.length === 0) {
    results.push({
      source: 'CloudWatch Logs',
      messages: [
        'No CloudWatch Logs configuration found. Enable logging to see container output on failure.',
        'Example (CDK):',
        '  taskDefinition.addContainer("app", {',
        '    image: ecs.ContainerImage.fromRegistry("my-image"),',
        '    logging: ecs.LogDrivers.awsLogs({ streamPrefix: "my-service" }),',
        '  });',
      ],
    });
    return results;
  }

  // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
  const logResults = await Promise.all(logConfigs.map(cfg => fetchRecentLogs(cwl, cfg, region, stoppedTaskResult.taskIds, debug)));
  let hasLogs = false;
  for (const context of logResults) {
    if (context) {
      results.push(context);
      hasLogs = true;
    }
  }

  if (!hasLogs) {
    results.push({
      source: 'CloudWatch Logs',
      messages: ['No application logs found (container may not have started). Check the stopped task reasons above for details.'],
    });
  }

  return results;
}

/**
 * Parse an ECS service physical resource ID into cluster and service identifiers.
 *
 * The cluster portion is a name (not an ARN) — `describeServices`/`describeTasks`
 * accept either form for their `cluster` parameter, so this is fine downstream.
 *
 * Recognized formats:
 * - Long ARN: `arn:aws:ecs:region:account:service/cluster-name/service-name` (current default)
 * - Path: `cluster-name/service-name`
 * - Bare service name (uses the default cluster)
 */
export function parseEcsServiceIdentifier(physicalId: string): { cluster?: string; serviceName?: string } {
  const arnMatch = physicalId.match(/^arn:[^:]+:ecs:[^:]*:[^:]*:service\/([^/]+)\/([^/]+)$/);
  if (arnMatch) {
    return { cluster: arnMatch[1], serviceName: arnMatch[2] };
  }

  const parts = physicalId.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { cluster: parts[0], serviceName: parts[1] };
  }
  if (parts.length === 1 && parts[0]) {
    return { serviceName: parts[0] };
  }

  return {};
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

interface StoppedTaskResult {
  context?: AdditionalDiagnosticContext;
  taskIds: string[];
}

async function getStoppedTaskReasons(
  ecs: IECSClient,
  cluster: string | undefined,
  serviceName: string,
  region: string,
  service: { events?: Array<{ message?: string }>; [key: string]: any },
  debug: (msg: string) => Promise<void>,
): Promise<StoppedTaskResult> {
  try {
    const failureEvents = (service.events ?? [])
      .filter(e => e.message?.includes('stopped') || e.message?.includes('failed') || e.message?.includes('unhealthy'))
      .slice(0, 5);

    if (failureEvents.length === 0) {
      return { taskIds: [] };
    }

    const taskIds = failureEvents
      .map(e => {
        const match = e.message?.match(/task ([a-f0-9-]+)/);
        return match ? match[1] : undefined;
      })
      .filter((id): id is string => id != null)
      .slice(0, 3);

    const messages: string[] = [];

    if (taskIds.length > 0) {
      // Show details from the most recently failed task only
      const tasksResp = await ecs.describeTasks({ cluster, tasks: [taskIds[0]] });
      const task = tasksResp.tasks?.[0];
      if (task) {
        if (task.stoppedReason) {
          messages.push(`Task stopped: ${task.stoppedReason}`);
        }
        for (const container of task.containers ?? []) {
          if (container.reason) {
            messages.push(`Container "${container.name}": ${container.reason}`);
          }
          if (container.exitCode != null && container.exitCode !== 0) {
            messages.push(`Container "${container.name}" exited with code ${container.exitCode}`);
          }
        }
      }
      if (messages.length > 0 && taskIds.length > 1) {
        messages.push(`(${taskIds.length - 1} other failed task(s) not shown)`);
      }
    }

    if (messages.length === 0) {
      const firstEvent = failureEvents[0];
      if (firstEvent?.message) {
        messages.push(firstEvent.message);
      }
      if (failureEvents.length > 1) {
        messages.push(`(${failureEvents.length - 1} other failure event(s) not shown)`);
      }
    }

    if (messages.length === 0) {
      return { taskIds };
    }

    return {
      context: {
        source: 'ECS Stopped Tasks',
        messages,
        link: ecsStoppedTasksConsoleUrl(region, cluster ?? 'default', serviceName),
      },
      taskIds,
    };
  } catch (e: any) {
    await debug(`ECS investigation: failed to get stopped task reasons: ${e.message}`);
    return { taskIds: [] };
  }
}

interface AwsLogsConfig {
  logGroup: string;
  streamPrefix?: string;
  containerName?: string;
}

interface TaskDefinitionInfo {
  logConfigs: AwsLogsConfig[];
  images: string[];
}

async function getTaskDefinitionInfo(
  ecs: IECSClient,
  taskDefinitionArn: string,
  debug: (msg: string) => Promise<void>,
): Promise<TaskDefinitionInfo | undefined> {
  try {
    const resp = await ecs.describeTaskDefinition({ taskDefinition: taskDefinitionArn });
    const containers = resp.taskDefinition?.containerDefinitions ?? [];
    const logConfigs: AwsLogsConfig[] = [];
    const images: string[] = [];
    for (const container of containers) {
      if (container.image) {
        images.push(`${container.name}: ${container.image}`);
      }
      const logConfig = container.logConfiguration;
      if (logConfig?.logDriver === 'awslogs') {
        const logGroup = logConfig.options?.['awslogs-group'];
        if (logGroup) {
          logConfigs.push({
            logGroup,
            streamPrefix: logConfig.options?.['awslogs-stream-prefix'],
            containerName: container.name,
          });
        }
      }
    }
    return { logConfigs, images };
  } catch (e: any) {
    await debug(`ECS investigation: failed to describe task definition: ${e.message}`);
    return undefined;
  }
}

async function fetchRecentLogs(
  cwl: ICloudWatchLogsClient,
  logConfig: AwsLogsConfig,
  region: string,
  taskIds: string[],
  debug: (msg: string) => Promise<void>,
): Promise<AdditionalDiagnosticContext | undefined | null> {
  try {
    // Target the most recently failed task's log stream for the most relevant output
    const lastTaskId = taskIds[0];
    const targetStream = (logConfig.streamPrefix && logConfig.containerName && lastTaskId)
      ? `${logConfig.streamPrefix}/${logConfig.containerName}/${lastTaskId}`
      : undefined;

    const resp = await cwl.filterLogEvents({
      logGroupName: logConfig.logGroup,
      startTime: Date.now() - 30 * 60 * 1000,
      limit: 1000,
      ...(targetStream
        ? { logStreamNames: [targetStream] }
        : logConfig.streamPrefix ? { logStreamNamePrefix: logConfig.streamPrefix } : {}),
    });

    const events = resp.events ?? [];
    if (events.length === 0) {
      await debug(`ECS investigation: no recent log events in ${logConfig.logGroup}${targetStream ? ` (targeted stream: ${targetStream})` : ''}`);
      return undefined;
    }

    // Keep the most recent lines (newer output is more useful for diagnosis).
    // This is the only truncation point — the formatter renders these verbatim.
    const allMessages = events
      .map(e => e.message?.trimEnd())
      .filter((m): m is string => m != null);
    const messages: string[] = allMessages.slice(-MAX_LOG_LINES);
    const omitted = allMessages.length - messages.length;
    if (omitted > 0) {
      messages.unshift(`... (${omitted} earlier lines omitted)`);
    }

    if (taskIds.length > 1) {
      messages.push(`(showing logs from last failed task; ${taskIds.length - 1} other failed task(s) available in console)`);
    }

    const source = logConfig.containerName
      ? `CloudWatch Logs: ${logConfig.logGroup} (container: ${logConfig.containerName})`
      : `CloudWatch Logs: ${logConfig.logGroup}`;

    return {
      source,
      messages,
      link: cloudWatchLogsConsoleUrl(region, logConfig.logGroup),
    };
  } catch (e: any) {
    await debug(`ECS investigation: failed to fetch logs from ${logConfig.logGroup}: ${e.message}`);
    return null;
  }
}

// CloudWatch console uses double-URI-encoding with '$' replacing '%' for the log group in the fragment.
function cloudWatchLogsConsoleUrl(region: string, logGroup: string): string {
  const encodedLogGroup = encodeURIComponent(encodeURIComponent(logGroup)).replace(/%/g, '$');
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${encodedLogGroup}`;
}

function ecsStoppedTasksConsoleUrl(region: string, cluster: string, serviceName: string): string {
  return `https://${region}.console.aws.amazon.com/ecs/v2/clusters/${cluster}/services/${serviceName}/tasks?status=STOPPED&region=${region}`;
}
