import type { AdditionalDiagnosticContext } from '../../actions/diagnose';
import { deserializeStructure } from '../../util';
import type { ICloudFormationClient, ICloudWatchLogsClient, IECSClient, ILambdaClient, SDK } from '../aws-auth/sdk';
import type { ResourceError } from '../stack-events/resource-errors';

/**
 * Maximum number of log lines included per CloudWatch Logs context block.
 *
 * The formatter renders the messages array verbatim, so this is the
 * single user-visible cap.
 */
const MAX_LOG_LINES = 50;

/** Fallback look-back when no failure timestamp is available. */
const FALLBACK_LOG_WINDOW_MS = 30 * 60 * 1000;

/**
 * Turn raw CloudWatch log event messages into the trimmed lines we render.
 *
 * Keeps only the most recent {@link MAX_LOG_LINES} (newer output is more useful for
 * diagnosis) and prepends an "N earlier lines omitted" marker when truncation happened.
 * This is the single truncation point shared by all CloudWatch contexts — the formatter
 * renders the result verbatim.
 */
function trimToRecentLines(events: Array<{ message?: string }>): string[] {
  const allMessages = events
    .map(e => e.message?.trimEnd())
    .filter((m): m is string => m != null);
  const messages = allMessages.slice(-MAX_LOG_LINES);
  const omitted = allMessages.length - messages.length;
  if (omitted > 0) {
    messages.unshift(`... (${omitted} earlier lines omitted)`);
  }
  return messages;
}

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

  const serviceToken = await getCustomResourceServiceToken(cfn, stackName, err.logicalId, debug);
  if (serviceToken === undefined) {
    return [];
  }

  const functionName = await resolveServiceTokenToFunctionName(cfn, stackName, serviceToken, debug);
  if (!functionName) {
    await debug('Custom resource investigation: could not resolve ServiceToken to a Lambda function');
    return [];
  }

  // The cfn-response library writes the failing log stream name into the status reason
  // (and uses it as the default physical ID). Targeting it gives the exact invocation.
  const streamName = extractLogStreamName(err.message) ?? logStreamNameFromPhysicalId(err.physicalId);

  return fetchCustomResourceLogs(cwl, lambda, functionName, streamName, err.timestamp, region, debug);
}

/**
 * Read the failed custom resource's `ServiceToken` property from the stack's original template.
 *
 * Returns `undefined` if the template can't be read or the resource/property is missing.
 */
async function getCustomResourceServiceToken(
  cfn: ICloudFormationClient,
  stackName: string,
  logicalId: string,
  debug: (msg: string) => Promise<void>,
): Promise<any | undefined> {
  try {
    const resp = await cfn.getTemplate({ StackName: stackName });
    if (!resp.TemplateBody) {
      await debug('Custom resource investigation: empty template body');
      return undefined;
    }
    const template = deserializeStructure(resp.TemplateBody);
    const serviceToken = template?.Resources?.[logicalId]?.Properties?.ServiceToken;
    if (serviceToken === undefined) {
      await debug(`Custom resource investigation: no ServiceToken on resource "${logicalId}"`);
    }
    return serviceToken;
  } catch (e: any) {
    await debug(`Custom resource investigation: failed to read template: ${e.message}`);
    return undefined;
  }
}

/**
 * Resolve a `ServiceToken` value (a literal ARN, an `Fn::GetAtt`, or a `Ref`) to a Lambda
 * function name. Intrinsics are resolved to a physical ID via `describeStackResources`.
 */
async function resolveServiceTokenToFunctionName(
  cfn: ICloudFormationClient,
  stackName: string,
  serviceToken: any,
  debug: (msg: string) => Promise<void>,
): Promise<string | undefined> {
  const referencedLogicalId = serviceTokenReferencedLogicalId(serviceToken);
  if (referencedLogicalId) {
    try {
      const resp = await cfn.describeStackResources({ StackName: stackName, LogicalResourceId: referencedLogicalId });
      const physicalId = resp.StackResources?.[0]?.PhysicalResourceId;
      return physicalId ? functionNameFromArnOrName(physicalId) : undefined;
    } catch (e: any) {
      await debug(`Custom resource investigation: failed to resolve ServiceToken reference "${referencedLogicalId}": ${e.message}`);
      return undefined;
    }
  }

  if (typeof serviceToken === 'string') {
    return functionNameFromArnOrName(serviceToken);
  }

  await debug('Custom resource investigation: unsupported ServiceToken shape');
  return undefined;
}

/**
 * If a ServiceToken is an `Fn::GetAtt` or `Ref` intrinsic, return the referenced logical ID.
 */
export function serviceTokenReferencedLogicalId(serviceToken: any): string | undefined {
  if (!serviceToken || typeof serviceToken !== 'object') {
    return undefined;
  }
  const getAtt = serviceToken['Fn::GetAtt'];
  // Array form (JSON / CDK output): ["LogicalId", "Arn"].
  if (Array.isArray(getAtt) && typeof getAtt[0] === 'string') {
    return getAtt[0];
  }
  // String short-form (how YAML `!GetAtt LogicalId.Arn` deserializes): "LogicalId.Attr".
  if (typeof getAtt === 'string') {
    return getAtt.split('.')[0] || undefined;
  }
  if (typeof serviceToken.Ref === 'string') {
    return serviceToken.Ref;
  }
  return undefined;
}

/**
 * Extract a Lambda function name from a function ARN or a bare name.
 *
 * Returns `undefined` for non-Lambda ARNs (e.g. an SNS-topic ServiceToken).
 */
export function functionNameFromArnOrName(arnOrName: string): string | undefined {
  const arnMatch = arnOrName.match(/^arn:[^:]+:lambda:[^:]*:[^:]*:function:([^:]+)/);
  if (arnMatch) {
    return arnMatch[1];
  }
  if (arnOrName.startsWith('arn:')) {
    return undefined;
  }
  return arnOrName || undefined;
}

/**
 * Extract the log stream name out of a cfn-response failure reason
 * ("See the details in CloudWatch Log Stream: <name>").
 */
export function extractLogStreamName(message: string | undefined): string | undefined {
  const match = message?.match(/CloudWatch Log Stream:\s*(\S+)/);
  return match ? match[1] : undefined;
}

/**
 * cfn-response defaults the physical ID to the log stream name. Use it only when it looks
 * like a Lambda log stream (`YYYY/MM/DD/...`), so a user-provided physical ID isn't mistaken
 * for one.
 */
function logStreamNameFromPhysicalId(physicalId: string | undefined): string | undefined {
  return physicalId && /^\d{4}\/\d{2}\/\d{2}\/.+/.test(physicalId) ? physicalId : undefined;
}

async function fetchCustomResourceLogs(
  cwl: ICloudWatchLogsClient,
  lambda: ILambdaClient,
  functionName: string,
  streamName: string | undefined,
  timestamp: Date | undefined,
  region: string,
  debug: (msg: string) => Promise<void>,
): Promise<AdditionalDiagnosticContext[]> {
  const failureTime = timestamp?.valueOf();
  const startTime = failureTime !== undefined ? failureTime - LOG_WINDOW_BEFORE_MS : Date.now() - FALLBACK_LOG_WINDOW_MS;
  const endTime = failureTime !== undefined ? failureTime + LOG_WINDOW_AFTER_MS : undefined;

  // Convention first; only pay for getFunctionConfiguration if the convention group is empty.
  const conventionGroup = `/aws/lambda/${functionName}`;
  let messages = await fetchLogLines(cwl, conventionGroup, streamName, startTime, endTime, debug);
  // The group we point the user at. Once we learn the function's configured log group, prefer
  // it for the link even if it too is empty — it's where the function actually logs, whereas
  // the convention group may not exist for advanced-logging functions.
  let logGroup = conventionGroup;

  if (messages === undefined) {
    const configuredGroup = await configuredLogGroup(lambda, functionName, debug);
    if (configuredGroup && configuredGroup !== conventionGroup) {
      logGroup = configuredGroup;
      messages = await fetchLogLines(cwl, configuredGroup, streamName, startTime, endTime, debug);
    }
  }

  // Lead with the log group so the user can tell which function these logs belong to
  // (the formatter renders messages but not `source`, and the link is URL-encoded).
  const header = `Logs from ${logGroup}:`;
  const body = messages ?? ['No log events found around the time of failure. The function may not have produced output, or logging may not be configured.'];

  return [{
    source: 'Custom Resource Lambda Logs',
    messages: [header, ...body],
    link: cloudWatchLogsConsoleUrl(region, logGroup),
    linkLabel: 'Logs',
  }];
}

/**
 * Fetch and trim recent log lines from a group. Returns `undefined` when the group has no
 * events in the window (so the caller can try a different group).
 */
async function fetchLogLines(
  cwl: ICloudWatchLogsClient,
  logGroup: string,
  streamName: string | undefined,
  startTime: number,
  endTime: number | undefined,
  debug: (msg: string) => Promise<void>,
): Promise<string[] | undefined> {
  // Try the targeted stream first (most relevant), but the cfn-response stream name can be
  // stale on update/rollback failures (it's pinned to the original create invocation). If
  // the targeted query finds nothing, fall back to a group-wide scan over the time window so
  // a stale stream can't hide the actual failing invocation's logs.
  if (streamName) {
    const targeted = await filterLogLines(cwl, logGroup, streamName, startTime, endTime, debug);
    if (targeted !== undefined) {
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
): Promise<string[] | undefined> {
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
      return undefined;
    }
    return trimToRecentLines(events);
  } catch (e: any) {
    await debug(`Custom resource investigation: failed to fetch logs from ${logGroup}: ${e.message}`);
    return undefined;
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

// CloudWatch console uses double-URI-encoding with '$' replacing '%' for the log group in the fragment.
function cloudWatchLogsConsoleUrl(region: string, logGroup: string): string {
  const encodedLogGroup = encodeURIComponent(encodeURIComponent(logGroup)).replace(/%/g, '$');
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${encodedLogGroup}`;
}

function ecsStoppedTasksConsoleUrl(region: string, cluster: string, serviceName: string): string {
  return `https://${region}.console.aws.amazon.com/ecs/v2/clusters/${cluster}/services/${serviceName}/tasks?status=STOPPED&region=${region}`;
}
