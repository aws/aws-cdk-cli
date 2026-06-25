import { trimToRecentLines, parseLambdaLogEvents, cloudWatchLogsConsoleUrl } from './format-utils';
import type { InvestigateOptions } from './investigate-ecs-service';
import {
  serviceTokenReferencedLogicalId,
  functionNameFromArnOrName,
  extractLogStreamName,
  logStreamNameFromPhysicalId,
} from './resource-identifiers';
import type { AdditionalDiagnosticContext } from '../../actions/diagnose';
import { deserializeStructure } from '../../util';
import type { ICloudFormationClient, ICloudTrailClient, ICloudWatchLogsClient, ILambdaClient, SDK } from '../aws-auth/sdk';
import type { ResourceError } from '../stack-events/resource-errors';

/**
 * Options for the custom-resource investigation, including the CloudTrail lookup that is
 * specific to it (the backing Lambda's control-plane errors). ECS and other resource types
 * do not consult CloudTrail, so this option is not on the shared {@link InvestigateOptions}.
 */
export interface InvestigateCustomResourceOptions extends InvestigateOptions {
  /**
   * Whether CloudTrail may be consulted for control-plane errors (e.g. AccessDenied) made by
   * the backing Lambda around the failure.
   *
   * Off during `deploy` (CloudTrail events aren't delivered yet); on during `diagnose`.
   *
   * @default false
   */
  readonly cloudTrailEnabled?: boolean;
}

/** Fallback look-back when no failure timestamp is available. */
const FALLBACK_LOG_WINDOW_MS = 30 * 60 * 1000;

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
export async function investigateCustomResource(
  err: ResourceError,
  sdk: SDK,
  debug: (msg: string) => Promise<void>,
  options: InvestigateCustomResourceOptions = {},
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

  const results = await fetchCustomResourceLogs(cwl, lambda, functionName, templateLogGroup, streamName, err.timestamp, region, debug);

  // Control-plane errors (e.g. the function's execution role being denied an API call) don't
  // appear in the function's own logs in a usable form, but CloudTrail records them. Those
  // events are delivered with a few minutes' latency, so they're only worth querying on the
  // `diagnose` path (run after the fact) — on `deploy` we instead point the user there.
  if (!options.cloudTrailEnabled) {
    results.push({
      source: 'CloudTrail',
      messages: [
        'If this looks like a permissions error, run `cdk diagnose` in a few minutes:',
        'CloudTrail records control-plane errors (e.g. AccessDenied) that the logs above may',
        'not show, but its events take several minutes to become available.',
      ],
    });
  } else if (err.timestamp) {
    // Only query CloudTrail when we can bound the search to the failure time. Without a
    // timestamp (e.g. change-set / early-validation errors) the window would default to "now",
    // surfacing unrelated recent activity by the same function and misleading the user.
    const ctContext = await investigateViaCloudTrail(sdk.cloudTrail(), functionName, err.timestamp, debug);
    if (ctContext) {
      results.push(ctContext);
    }
  }

  return results;
}

/**
 * Maximum number of CloudTrail error events to surface.
 */
const MAX_CLOUDTRAIL_EVENTS = 5;

/**
 * Maximum CloudTrail result pages to page through (bounds the work; the events we want are
 * scoped to the function and the window, so this is a generous safety cap).
 */
const MAX_CLOUDTRAIL_PAGES = 5;

/**
 * How far before/after the failure to scan CloudTrail (events have delivery latency and the
 * window of interest is the failing invocation).
 */
const CLOUDTRAIL_WINDOW_BEFORE_MS = 5 * 60 * 1000;
const CLOUDTRAIL_WINDOW_AFTER_MS = 15 * 60 * 1000;

/**
 * Look up CloudTrail for errored API calls (e.g. AccessDenied) made by the backing Lambda
 * around the time of failure, and surface them.
 *
 * The lookup is scoped to the function server-side via the Username attribute (the Lambda
 * execution role's assumed-role session name is the function name, which CloudTrail indexes
 * as the event Username), so it returns only the function's own calls. Returns `undefined`
 * when there's nothing useful (or the lookup fails — best-effort like everything else here).
 */
async function investigateViaCloudTrail(
  cloudTrail: ICloudTrailClient,
  functionName: string,
  timestamp: Date,
  debug: (msg: string) => Promise<void>,
): Promise<AdditionalDiagnosticContext | undefined> {
  const failureTime = timestamp.valueOf();
  try {
    const events: ParsedCloudTrailEvent[] = [];
    let nextToken: string | undefined;
    let pages = 0;
    do {
      const resp = await cloudTrail.lookupEvents({
        LookupAttributes: [{ AttributeKey: 'Username', AttributeValue: functionName }],
        StartTime: new Date(failureTime - CLOUDTRAIL_WINDOW_BEFORE_MS),
        EndTime: new Date(failureTime + CLOUDTRAIL_WINDOW_AFTER_MS),
        MaxResults: 50,
        NextToken: nextToken,
      });
      for (const e of resp.Events ?? []) {
        const parsed = parseCloudTrailEvent(e.CloudTrailEvent);
        if (parsed) {
          events.push(parsed);
        }
      }
      nextToken = resp.NextToken;
    } while (nextToken && ++pages < MAX_CLOUDTRAIL_PAGES);

    const errorEvents = events.filter(e => e.errorCode);
    if (errorEvents.length === 0) {
      await debug(`CloudTrail: no errored events for ${functionName} in the failure window`);
      return undefined;
    }

    const shown = errorEvents.slice(0, MAX_CLOUDTRAIL_EVENTS);
    const messages = shown.map(e => `${e.errorCode} on ${e.eventSource ?? '?'}:${e.eventName ?? '?'}${e.errorMessage ? ` — ${e.errorMessage}` : ''}`);
    if (errorEvents.length > shown.length) {
      messages.push(`(${errorEvents.length - shown.length} more error event(s) not shown)`);
    }

    return { source: 'CloudTrail Errors', messages };
  } catch (e: any) {
    await debug(`CloudTrail: lookup failed: ${e.message}`);
    return undefined;
  }
}

interface ParsedCloudTrailEvent {
  eventName?: string;
  eventSource?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** Parse the `CloudTrailEvent` JSON blob into the fields we care about. */
function parseCloudTrailEvent(json: string | undefined): ParsedCloudTrailEvent | undefined {
  if (!json) {
    return undefined;
  }
  try {
    const obj = JSON.parse(json);
    return {
      eventName: typeof obj.eventName === 'string' ? obj.eventName : undefined,
      eventSource: typeof obj.eventSource === 'string' ? obj.eventSource : undefined,
      errorCode: typeof obj.errorCode === 'string' ? obj.errorCode : undefined,
      errorMessage: typeof obj.errorMessage === 'string' ? obj.errorMessage : undefined,
    };
  } catch {
    return undefined;
  }
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
