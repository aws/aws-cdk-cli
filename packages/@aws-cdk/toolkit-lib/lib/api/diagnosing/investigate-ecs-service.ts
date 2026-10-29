import { trimToRecentLines, cloudWatchLogsConsoleUrl } from './format-utils';
import { parseEcsServiceIdentifier, ecsStoppedTasksConsoleUrl } from './resource-identifiers';
import type { AdditionalDiagnosticContext } from '../../actions/diagnose';
import type { ICloudWatchLogsClient, IECSClient, SDK } from '../aws-auth/sdk';
import type { ResourceError } from '../stack-events/resource-errors';

/** Fallback look-back when no failure timestamp is available. */
const FALLBACK_LOG_WINDOW_MS = 30 * 60 * 1000;

/**
 * Options that influence how a resource is investigated.
 *
 * This is shared by all resource-type investigations, so it only carries options that
 * apply across them.
 */
export interface InvestigateOptions {
  /**
   * Whether CloudFormation rollback is enabled for this deployment.
   *
   * When rollback is enabled, a failed resource is torn down before we can
   * inspect its runtime state, so we may suggest re-running with `--no-rollback`
   * to retain that detail.
   *
   * @default true
   */
  readonly rollbackEnabled?: boolean;
}

export async function investigateEcsService(
  err: ResourceError,
  sdk: SDK,
  debug: (msg: string) => Promise<void>,
  options: InvestigateOptions,
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
    // The service is gone. The most common reason is that CloudFormation rolled the
    // deployment back and deleted it, taking the task/runtime detail with it. If rollback
    // was enabled, point the user at the flag that would have retained that detail.
    if (options.rollbackEnabled) {
      return [{
        source: 'ECS Service',
        messages: [
          'The service and its tasks were removed during rollback, so container-level failure detail is unavailable.',
          'Re-run the deployment with `--no-rollback` to retain the failed tasks and see why they stopped.',
        ],
      }];
    }
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
  if (!taskDefInfo) {
    return results;
  }

  const logConfigs = taskDefInfo.logConfigs;

  if (logConfigs.length === 0) {
    results.push({
      source: 'CloudWatch Logs',
      messages: [
        'No CloudWatch Logs configuration found. Enable logging to see container output on failure.',
        'Example:',
        '  taskDefinition.addContainer("app", {',
        '    // ...',
        '    logging: ecs.LogDrivers.awsLogs({ streamPrefix: "my-service" }),',
        '  });',
      ],
    });
    return results;
  }

  // `logConfigs` has one entry per container in the task definition that uses the awslogs
  // driver — a handful at most — so this fan-out is bounded by the task shape and needs no
  // explicit concurrency limit.
  // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
  const logResults = await Promise.all(logConfigs.map(cfg => fetchRecentLogs(cwl, cfg, region, stoppedTaskResult.taskIds, debug)));
  const logContexts = logResults.filter((c): c is AdditionalDiagnosticContext => c !== undefined);

  results.push(...logContexts);
  if (logContexts.length === 0) {
    results.push({
      source: 'CloudWatch Logs',
      messages: ['No CloudWatch Logs found.'],
    });
  }

  return results;
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
    // Ask ECS for the service's stopped tasks. The IDs we need live in "has started 1 tasks: (task <id>)" events
    const taskIds = await listStoppedTaskIds(ecs, cluster, serviceName, debug);

    const messages: string[] = [];

    if (taskIds.length > 0) {
      // Show details from the most recently stopped task only.
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

    // Fall back to the most relevant service event if we couldn't get a task-level reason
    // (e.g. tasks already aged out, or no stopped tasks retained).
    if (messages.length === 0) {
      const failureEvent = (service.events ?? [])
        .find(e => e.message?.includes('stopped') || e.message?.includes('failed') || e.message?.includes('unhealthy'));
      if (failureEvent?.message) {
        messages.push(failureEvent.message);
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
        linkLabel: 'Tasks',
      },
      taskIds,
    };
  } catch (e: any) {
    await debug(`ECS investigation: failed to get stopped task reasons: ${e.message}`);
    return { taskIds: [] };
  }
}

/**
 * Maximum number of stopped task IDs to consider. We only render detail for the most
 * recent one, but keep a few so we can report how many others failed.
 */
const MAX_STOPPED_TASKS = 3;

/**
 * List the bare task IDs of the service's stopped tasks, newest first.
 *
 * Prefers scoping by service name; if that yields nothing (some ECS API versions only
 * apply the service filter to running tasks), falls back to listing the cluster's stopped
 * tasks. Returns an empty array if none are retained (e.g. they aged out, or rollback
 * already drained the cluster).
 */
async function listStoppedTaskIds(
  ecs: IECSClient,
  cluster: string | undefined,
  serviceName: string,
  debug: (msg: string) => Promise<void>,
): Promise<string[]> {
  const toIds = (arns: string[] | undefined) => (arns ?? []).map(arn => arn.split('/').pop()).filter((id): id is string => !!id);

  let arns: string[] | undefined;
  try {
    const byService = await ecs.listTasks({ cluster, serviceName, desiredStatus: 'STOPPED' });
    arns = byService.taskArns;
    if (!arns || arns.length === 0) {
      const byCluster = await ecs.listTasks({ cluster, desiredStatus: 'STOPPED' });
      arns = byCluster.taskArns;
    }
  } catch (e: any) {
    await debug(`ECS investigation: failed to list stopped tasks: ${e.message}`);
    return [];
  }

  return toIds(arns).slice(0, MAX_STOPPED_TASKS);
}

interface AwsLogsConfig {
  logGroup: string;
  streamPrefix?: string;
  containerName?: string;
}

interface TaskDefinitionInfo {
  logConfigs: AwsLogsConfig[];
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
    for (const container of containers) {
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
    return { logConfigs };
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
): Promise<AdditionalDiagnosticContext | undefined> {
  try {
    // Target the most recently failed task's log stream for the most relevant output
    const lastTaskId = taskIds[0];
    const targetStream = (logConfig.streamPrefix && logConfig.containerName && lastTaskId)
      ? `${logConfig.streamPrefix}/${logConfig.containerName}/${lastTaskId}`
      : undefined;

    const resp = await cwl.filterLogEvents({
      logGroupName: logConfig.logGroup,
      startTime: Date.now() - FALLBACK_LOG_WINDOW_MS,
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

    const messages = trimToRecentLines(
      events.map(e => e.message?.trimEnd()).filter((m): m is string => m != null),
    );

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
      linkLabel: 'Logs',
    };
  } catch (e: any) {
    await debug(`ECS investigation: failed to fetch logs from ${logConfig.logGroup}: ${e.message}`);
    return undefined;
  }
}
