import { trimToRecentLines, parseLambdaLogEvents, cloudWatchLogsConsoleUrl } from './format-utils';
import {
  parseEcsServiceIdentifier,
  serviceTokenReferencedLogicalId,
  functionNameFromArnOrName,
  extractLogStreamName,
  logStreamNameFromPhysicalId,
  ecsStoppedTasksConsoleUrl,
} from './resource-identifiers';
import type { AdditionalDiagnosticContext } from '../../actions/diagnose';
import { deserializeStructure } from '../../util';
import type { ICloudFormationClient, ICloudWatchLogsClient, IECSClient, ILambdaClient, SDK } from '../aws-auth/sdk';
import type { ResourceError } from '../stack-events/resource-errors';

/** Fallback look-back when no failure timestamp is available. */
const FALLBACK_LOG_WINDOW_MS = 30 * 60 * 1000;

/**
 * Options that influence how a resource is investigated.
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
  options: InvestigateOptions = {},
): Promise<AdditionalDiagnosticContext[]> {
  const resourceType = err.resourceType ?? '';
  if (resourceType === 'AWS::ECS::Service') {
    return investigateEcsService(err, sdk, debug, options);
  }
  if (resourceType === 'AWS::CloudFormation::CustomResource' || resourceType.startsWith('Custom::')) {
    return investigateCustomResource(err, sdk, debug);
  }
  return [];
}

async function investigateEcsService(
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

    const messages = trimToRecentLines(events);

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

/**
 * How far before/after the failure event to search CloudWatch Logs when we have a timestamp.
 *
 * The pre-window absorbs minor clock skew; the post-window covers output the function
 * emits while it runs after the CloudFormation event was recorded.
 */
const LOG_WINDOW_BEFORE_MS = 2 * 60 * 1000;
const LOG_WINDOW_AFTER_MS = 15 * 60 * 1000;

/**
 * Investigate a failed custom resource by surfacing its backing Lambda's CloudWatch logs.
 *
 * The CloudFormation event does not name the backing function — only the resource's
 * `ServiceToken` (in the template) does. We resolve that to a function name, derive the
 * log group (the `/aws/lambda/<fn>` convention, confirmed via the function's LoggingConfig
 * only if the convention turns up empty), and fetch the relevant log lines.
 *
 * When the handler uses the cfn-response library, the failing log stream name is embedded
 * in the status reason ("See the details in CloudWatch Log Stream: <name>"), so we can
 * target that exact invocation.
 */
async function investigateCustomResource(
  err: ResourceError,
  sdk: SDK,
  debug: (msg: string) => Promise<void>,
): Promise<AdditionalDiagnosticContext[]> {
  if (!err.logicalId) {
    await debug('Custom resource investigation: no logical ID available');
    return [];
  }
  const stackName = err.stackArn;
  if (!stackName) {
    await debug('Custom resource investigation: no stack ARN available');
    return [];
  }

  const cfn = sdk.cloudFormation();
  const lambda = sdk.lambda();
  const cwl = sdk.cloudWatchLogs();
  const region = sdk.currentRegion;

  // Fetch the template once: it carries both the ServiceToken and (for functions defined in
  // this stack) the backing function's LoggingConfig. The template survives rollback even
  // when the function itself is deleted, so it's the most reliable source for the log group.
  const template = await getStackTemplate(cfn, stackName, debug);
  if (!template) {
    return [];
  }

  const serviceToken = template.Resources?.[err.logicalId]?.Properties?.ServiceToken;
  if (serviceToken === undefined) {
    await debug(`Custom resource investigation: no ServiceToken on resource "${err.logicalId}"`);
    return [];
  }

  const referencedLogicalId = serviceTokenReferencedLogicalId(serviceToken);
  const functionName = await resolveServiceTokenToFunctionName(cfn, stackName, serviceToken, referencedLogicalId, debug);
  if (!functionName) {
    await debug('Custom resource investigation: could not resolve ServiceToken to a Lambda function');
    return [];
  }

  // Prefer the function's configured log group as derived from the template (rollback-proof).
  // Only resolvable when the function is defined in this stack (ServiceToken is a Ref/GetAtt).
  const templateLogGroup = referencedLogicalId
    ? await resolveConfiguredLogGroup(cfn, stackName, template, referencedLogicalId, debug)
    : undefined;

  // The cfn-response library writes the failing log stream name into the status reason
  // (and uses it as the default physical ID). Targeting it gives the exact invocation.
  const streamName = extractLogStreamName(err.message) ?? logStreamNameFromPhysicalId(err.physicalId);

  return fetchCustomResourceLogs(cwl, lambda, functionName, templateLogGroup, streamName, err.timestamp, region, debug);
}

/**
 * Fetch and parse the stack's (original) template. Returns `undefined` if it can't be read.
 */
async function getStackTemplate(
  cfn: ICloudFormationClient,
  stackName: string,
  debug: (msg: string) => Promise<void>,
): Promise<any | undefined> {
  try {
    const resp = await cfn.getTemplate({ StackName: stackName, TemplateStage: 'Original' });
    if (!resp.TemplateBody) {
      await debug('Custom resource investigation: empty template body');
      return undefined;
    }
    return deserializeStructure(resp.TemplateBody);
  } catch (e: any) {
    await debug(`Custom resource investigation: failed to read template: ${e.message}`);
    return undefined;
  }
}

/**
 * Resolve the backing Lambda's configured log group from the template.
 *
 * The template survives rollback (when the live function may not), so it is the preferred
 * source. Handles the function's `LoggingConfig.LogGroup` as:
 * - a literal string (returned directly);
 * - a `Ref` to an `AWS::Logs::LogGroup` with a literal `LogGroupName` (returned directly);
 * - a `Ref` to an `AWS::Logs::LogGroup` whose name CloudFormation generates (the common CDK
 *   case) — resolved to its physical name via `describeStackResources`, which still returns
 *   RETAINed/orphaned resources after a rollback.
 *
 * Returns `undefined` when there is no configured log group or it can't be resolved
 * (caller then falls back to the live function configuration).
 */
async function resolveConfiguredLogGroup(
  cfn: ICloudFormationClient,
  stackName: string,
  template: any,
  functionLogicalId: string,
  debug: (msg: string) => Promise<void>,
): Promise<string | undefined> {
  const logGroup = template.Resources?.[functionLogicalId]?.Properties?.LoggingConfig?.LogGroup;
  if (typeof logGroup === 'string') {
    return logGroup;
  }
  if (logGroup && typeof logGroup === 'object' && typeof logGroup.Ref === 'string') {
    const referenced = template.Resources?.[logGroup.Ref];
    const name = referenced?.Properties?.LogGroupName;
    if (typeof name === 'string') {
      return name;
    }
    // No explicit name (CloudFormation generates it) — resolve the log-group resource's
    // physical name, which is the log group name.
    return (await resolveStackResource(cfn, stackName, logGroup.Ref, debug))?.physicalId;
  }
  return undefined;
}

/**
 * Resolve a resource's physical ID and type by logical ID. Returns `undefined` on failure.
 */
async function resolveStackResource(
  cfn: ICloudFormationClient,
  stackName: string,
  logicalId: string,
  debug: (msg: string) => Promise<void>,
): Promise<{ physicalId?: string; resourceType?: string } | undefined> {
  try {
    const resp = await cfn.describeStackResources({ StackName: stackName, LogicalResourceId: logicalId });
    const resource = resp.StackResources?.[0];
    return resource ? { physicalId: resource.PhysicalResourceId, resourceType: resource.ResourceType } : undefined;
  } catch (e: any) {
    await debug(`Custom resource investigation: failed to resolve resource "${logicalId}": ${e.message}`);
    return undefined;
  }
}

/**
 * Resolve a `ServiceToken` value (a literal ARN, an `Fn::GetAtt`, or a `Ref`) to a Lambda
 * function name. Intrinsics are resolved via `describeStackResources`.
 */
async function resolveServiceTokenToFunctionName(
  cfn: ICloudFormationClient,
  stackName: string,
  serviceToken: any,
  referencedLogicalId: string | undefined,
  debug: (msg: string) => Promise<void>,
): Promise<string | undefined> {
  if (referencedLogicalId) {
    const resource = await resolveStackResource(cfn, stackName, referencedLogicalId, debug);
    // Only treat the reference as a Lambda function. Without this, a ServiceToken pointing at
    // a non-Lambda resource (e.g. an SNS topic) whose physical ID is a bare name would be
    // mistaken for a function name, producing a misleading /aws/lambda/<name> log lookup.
    if (resource?.resourceType && resource.resourceType !== 'AWS::Lambda::Function') {
      await debug(`Custom resource investigation: ServiceToken references a ${resource.resourceType}, not a Lambda function`);
      return undefined;
    }
    return resource?.physicalId ? functionNameFromArnOrName(resource.physicalId) : undefined;
  }

  if (typeof serviceToken === 'string') {
    return functionNameFromArnOrName(serviceToken);
  }

  await debug('Custom resource investigation: unsupported ServiceToken shape');
  return undefined;
}

async function fetchCustomResourceLogs(
  cwl: ICloudWatchLogsClient,
  lambda: ILambdaClient,
  functionName: string,
  templateLogGroup: string | undefined,
  streamName: string | undefined,
  timestamp: Date | undefined,
  region: string,
  debug: (msg: string) => Promise<void>,
): Promise<AdditionalDiagnosticContext[]> {
  const failureTime = timestamp?.valueOf();
  const startTime = failureTime !== undefined ? failureTime - LOG_WINDOW_BEFORE_MS : Date.now() - FALLBACK_LOG_WINDOW_MS;
  const endTime = failureTime !== undefined ? failureTime + LOG_WINDOW_AFTER_MS : undefined;

  // Convention first; only pay for the configured group if the convention group doesn't yield usable lines (empty group or fetch error).
  const conventionGroup = `/aws/lambda/${functionName}`;
  let result = await fetchLogLines(cwl, conventionGroup, streamName, startTime, endTime, debug);
  // The group we point the user at. Once we learn the function's configured log group, prefer
  // it for the link even if it too is empty — it's where the function actually logs, whereas
  // the convention group may not exist for advanced-logging functions.
  let logGroup = conventionGroup;

  if (result.kind !== 'lines') {
    // Prefer the template-derived group (rollback-proof); fall back to the live function
    // configuration only when the template couldn't tell us (e.g. unresolvable intrinsic, or
    // the function is defined outside this stack).
    const configuredGroup = templateLogGroup ?? await configuredLogGroup(lambda, functionName, debug);
    if (configuredGroup && configuredGroup !== conventionGroup) {
      logGroup = configuredGroup;
      const configuredResult = await fetchLogLines(cwl, configuredGroup, streamName, startTime, endTime, debug);
      // Keep the configured-group result unless it errored while the convention attempt was a
      // clean empty (an "empty" answer is more informative to surface than a fetch error).
      if (configuredResult.kind === 'lines' || result.kind !== 'empty') {
        result = configuredResult;
      }
    }
  }

  // Lead with the log group so the user can tell which function these logs belong to
  // (the formatter renders messages but not `source`, and the link is URL-encoded).
  const header = `Logs from ${logGroup}:`;
  const body = result.kind === 'lines'
    ? result.lines
    : result.kind === 'error'
      ? ['Could not fetch logs (the log group may not exist, or the credentials lack logs:FilterLogEvents). See the console link below.']
      : ['No log events found around the time of failure. The function may not have produced output, or logging may not be configured.'];

  return [{
    source: 'Custom Resource Lambda Logs',
    messages: [header, ...body],
    link: cloudWatchLogsConsoleUrl(region, logGroup),
    linkLabel: 'Logs',
  }];
}

/**
 * Result of attempting to fetch logs from a group: the lines on success, or a reason we
 * have none — distinguishing an empty group from a failed fetch (e.g. missing permissions),
 * so the user-facing message can reflect the real cause.
 */
type LogFetchResult =
  | { kind: 'lines'; lines: string[] }
  | { kind: 'empty' }
  | { kind: 'error' };

/**
 * Fetch and trim recent log lines from a group.
 *
 * Tries the targeted stream first (most relevant), but the cfn-response stream name can be
 * stale on update/rollback failures (it's pinned to the original create invocation). If the
 * targeted query finds nothing, falls back to a group-wide scan over the time window so a
 * stale stream can't hide the actual failing invocation's logs.
 */
async function fetchLogLines(
  cwl: ICloudWatchLogsClient,
  logGroup: string,
  streamName: string | undefined,
  startTime: number,
  endTime: number | undefined,
  debug: (msg: string) => Promise<void>,
): Promise<LogFetchResult> {
  if (streamName) {
    const targeted = await filterLogLines(cwl, logGroup, streamName, startTime, endTime, debug);
    if (targeted.kind === 'lines') {
      return targeted;
    }
  }
  return filterLogLines(cwl, logGroup, undefined, startTime, endTime, debug);
}

async function filterLogLines(
  cwl: ICloudWatchLogsClient,
  logGroup: string,
  streamName: string | undefined,
  startTime: number,
  endTime: number | undefined,
  debug: (msg: string) => Promise<void>,
): Promise<LogFetchResult> {
  try {
    const resp = await cwl.filterLogEvents({
      logGroupName: logGroup,
      startTime,
      ...(endTime !== undefined ? { endTime } : {}),
      limit: 1000,
      ...(streamName ? { logStreamNames: [streamName] } : {}),
    });
    const events = resp.events ?? [];
    if (events.length === 0) {
      await debug(`Custom resource investigation: no log events in ${logGroup}${streamName ? ` (stream: ${streamName})` : ''}`);
      return { kind: 'empty' };
    }
    // Lambda log events have a known structure (text- or JSON-format), unlike raw ECS
    // container output, so we normalize them into readable lines before trimming.
    return { kind: 'lines', lines: trimToRecentLines(parseLambdaLogEvents(events)) };
  } catch (e: any) {
    await debug(`Custom resource investigation: failed to fetch logs from ${logGroup}: ${e.message}`);
    return { kind: 'error' };
  }
}

/** Read the function's configured (advanced-logging) log group, if any. */
async function configuredLogGroup(
  lambda: ILambdaClient,
  functionName: string,
  debug: (msg: string) => Promise<void>,
): Promise<string | undefined> {
  try {
    const resp = await lambda.getFunctionConfiguration({ FunctionName: functionName });
    return resp.LoggingConfig?.LogGroup;
  } catch (e: any) {
    await debug(`Custom resource investigation: failed to read function configuration: ${e.message}`);
    return undefined;
  }
}
