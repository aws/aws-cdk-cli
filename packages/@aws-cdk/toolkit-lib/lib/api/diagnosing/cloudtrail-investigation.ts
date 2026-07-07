import { functionNameFromArnOrName, serviceTokenReferencedLogicalId } from './resource-identifiers';
import type { AdditionalDiagnosticContext } from '../../actions/diagnose';
import { deserializeStructure } from '../../util';
import type { ICloudFormationClient, ICloudTrailClient, SDK } from '../aws-auth/sdk';
import type { IoHelper } from '../io/private/io-helper';
import type { ResourceError } from '../stack-events/resource-errors';

/**
 * Stack-level CloudTrail investigation.
 *
 * CloudTrail records management (control-plane) events — roughly, low-traffic configuration
 * APIs — including calls that fail. Those failures often carry the root cause of a deployment
 * failure that never reaches CloudFormation: a custom resource's handler being denied an API
 * call, or a service acting on a resource's behalf with that resource's role (e.g. Lambda
 * creating ENIs for a VPC-attached function). Data-plane calls (e.g. `s3:PutObject`) are not
 * recorded, so failures on those remain invisible to this investigation.
 *
 * The `LookupEvents` API accepts at most one server-side filter, and service-on-your-behalf
 * calls use unpredictable assumed-role session names, so there is no per-resource lookup key
 * we could compute. Instead we do one unfiltered sweep over the failure window and correlate
 * client-side: an event belongs to the stack if any known stack identity (physical IDs, IAM
 * roles referenced by resource properties, custom-resource backing functions) appears in the
 * event's `userIdentity` ARNs or `resources` list. A missed correlation degrades to "no
 * events found" — never a wrong attribution.
 */

/**
 * How far before the first failure event to scan.
 *
 * The fatal API call always precedes the failure event CloudFormation records, sometimes by
 * minutes (e.g. a provider-framework handler that polls before giving up).
 */
const SWEEP_WINDOW_BEFORE_MS = 5 * 60 * 1000;

/**
 * How far after the last failure event to scan.
 *
 * Small on purpose: rollback begins right after the last failure event, and teardown
 * produces large numbers of irrelevant errored events (e.g. polling of already-deleted
 * resources) that would drown out the root cause.
 */
const SWEEP_WINDOW_AFTER_MS = 2 * 60 * 1000;

/**
 * Maximum pages of `LookupEvents` results (50 events each) per sweep.
 *
 * A quiet account produces ~2-3 pages for a five-minute window; busy accounts can exceed
 * this cap, in which case the output discloses that the scan was truncated.
 */
const MAX_SWEEP_PAGES = 10;

/**
 * Maximum distinct error events to surface.
 */
const MAX_EVENTS_SHOWN = 5;

/**
 * Minimum length for an identity key. Substring matching with short keys (e.g. a physical ID
 * like "web") would match unrelated events.
 */
const MIN_IDENTITY_KEY_LENGTH = 8;

/**
 * If a sweep finds nothing and the failure is more recent than this, the events may simply
 * not have been delivered yet (CloudTrail delivery averages ~5 minutes, up to 15).
 */
const DELIVERY_LATENCY_MS = 15 * 60 * 1000;

/**
 * An identity that ties CloudTrail events back to a stack resource.
 */
interface StackIdentity {
  /**
   * The string to look for inside the event's identity/resource ARNs.
   */
  readonly key: string;

  /**
   * Logical ID of the stack resource this identity belongs to.
   */
  readonly logicalId: string;

  /**
   * Human-readable description of the resource, for attribution in the output.
   */
  readonly description: string;
}

/**
 * A CloudTrail error event correlated to a stack resource.
 */
export interface CorrelatedCloudTrailError {
  /**
   * Logical ID of the stack resource the event was attributed to.
   */
  readonly logicalId: string;

  /**
   * The formatted, user-facing description of the event.
   */
  readonly message: string;

  /**
   * Time the API call was made (not when the event was delivered).
   */
  readonly eventTime?: Date;
}

/**
 * Result of a CloudTrail investigation for a stack.
 */
export interface CloudTrailInvestigation {
  /**
   * Correlated error events, deduplicated, earliest-first, capped at {@link MAX_EVENTS_SHOWN}.
   */
  readonly errors: CorrelatedCloudTrailError[];

  /**
   * Extra notes about the scan itself (e.g. truncation, delivery-latency hint).
   */
  readonly notes: string[];
}

/**
 * Investigate a failed stack via CloudTrail: sweep the failure window for errored
 * control-plane calls made by the stack's own principals, and return them attributed to the
 * resource they belong to.
 *
 * Returns `undefined` when the investigation could not run (no failure timestamps to bound
 * the window, or the lookup itself failed). Lookup failures are reported through the IoHost
 * as warnings — a broken lookup is a tooling problem, not a diagnosis result.
 */
export async function investigateStackViaCloudTrail(
  sdk: SDK,
  errors: readonly ResourceError[],
  ioHelper: IoHelper,
): Promise<CloudTrailInvestigation | undefined> {
  const debug = (msg: string) => ioHelper.defaults.debug(msg);

  // Without failure timestamps (change-set / early-validation errors) we cannot bound the
  // sweep; an unbounded window would surface unrelated account activity.
  const timestamps = errors.map((e) => e.timestamp?.valueOf()).filter((t): t is number => t !== undefined);
  if (timestamps.length === 0) {
    await debug('CloudTrail investigation: no failure timestamps to bound the window');
    return undefined;
  }

  // All failure events precede the rollback that follows them, so ending the window shortly
  // after the last failure event naturally excludes rollback/teardown noise.
  const windowStart = new Date(Math.min(...timestamps) - SWEEP_WINDOW_BEFORE_MS);
  const windowEnd = new Date(Math.max(...timestamps) + SWEEP_WINDOW_AFTER_MS);

  const cfn = sdk.cloudFormation();
  const identities: StackIdentity[] = [];
  for (const stackArn of new Set(errors.map((e) => e.stackArn).filter((s) => !!s))) {
    identities.push(...await buildStackIdentitySet(cfn, stackArn, debug));
  }
  if (identities.length === 0) {
    await debug('CloudTrail investigation: no stack identities to correlate against');
    return undefined;
  }

  const sweep = await sweepCloudTrail(sdk.cloudTrail(), windowStart, windowEnd, ioHelper);
  if (!sweep) {
    return undefined;
  }

  const correlated = correlateEvents(sweep.events, identities);

  const notes: string[] = [];
  if (sweep.truncated) {
    notes.push(`(only the most recent ${sweep.events.length} CloudTrail events in the window were checked)`);
  }
  if (correlated.length === 0 && Date.now() - Math.max(...timestamps) < DELIVERY_LATENCY_MS) {
    notes.push(
      'CloudTrail events for this failure may not be delivered yet (delivery takes up to 15 minutes). ' +
      'Re-run `cdk diagnose` in a few minutes to check for control-plane errors (e.g. AccessDenied).',
    );
  }

  return { errors: presentEvents(correlated), notes };
}

/**
 * Group a CloudTrail investigation's findings into per-resource diagnostic contexts.
 *
 * Returns a map from logical ID to the context to attach to that resource's diagnosis.
 * Notes and events for resources that are not among the errored resources are up to the
 * caller to place (typically on the stack-level or first problem).
 */
export function cloudTrailContextsByLogicalId(investigation: CloudTrailInvestigation): Map<string, AdditionalDiagnosticContext> {
  const byLogicalId = new Map<string, string[]>();
  for (const e of investigation.errors) {
    const existing = byLogicalId.get(e.logicalId) ?? [];
    existing.push(e.message);
    byLogicalId.set(e.logicalId, existing);
  }

  const ret = new Map<string, AdditionalDiagnosticContext>();
  for (const [logicalId, messages] of byLogicalId) {
    ret.set(logicalId, { source: 'CloudTrail Errors', messages });
  }
  return ret;
}

/**
 * Build the set of identities that tie CloudTrail events back to this stack:
 *
 * - physical IDs of all stack resources (they appear in event `resources[].ARN` lists and
 *   in assumed-role session ARNs);
 * - IAM roles referenced by resource properties ending in `Role`/`RoleArn` (services acting
 *   on a resource's behalf assume these; the role *name* — not ARN — is embedded in the
 *   resulting session ARN, so bare names are indexed too);
 * - custom-resource backing Lambda functions (a Lambda's role-session name is the function
 *   name).
 */
async function buildStackIdentitySet(
  cfn: ICloudFormationClient,
  stackArn: string,
  debug: (msg: string) => Promise<void>,
): Promise<StackIdentity[]> {
  const identities: StackIdentity[] = [];
  const seen = new Set<string>();
  const add = (key: string | undefined, logicalId: string, description: string) => {
    if (key && key.length >= MIN_IDENTITY_KEY_LENGTH && !seen.has(key)) {
      seen.add(key);
      identities.push({ key, logicalId, description });
    }
  };

  let physicalIdByLogicalId = new Map<string, string>();
  try {
    const resp = await cfn.describeStackResources({ StackName: stackArn });
    for (const r of resp.StackResources ?? []) {
      if (r.LogicalResourceId && r.PhysicalResourceId) {
        physicalIdByLogicalId.set(r.LogicalResourceId, r.PhysicalResourceId);
        add(r.PhysicalResourceId, r.LogicalResourceId, `${r.LogicalResourceId} (${r.ResourceType})`);
        // ARN-shaped physical IDs also get their trailing name segment indexed: session ARNs
        // embed names, not ARNs.
        add(nameSegment(r.PhysicalResourceId), r.LogicalResourceId, `${r.LogicalResourceId} (${r.ResourceType})`);
      }
    }
  } catch (e: any) {
    await debug(`CloudTrail investigation: failed to list stack resources: ${e.message}`);
    return [];
  }

  const template = await getStackTemplate(cfn, stackArn, debug);
  for (const [logicalId, resource] of Object.entries<any>(template?.Resources ?? {})) {
    const props = resource?.Properties;
    if (!props || typeof props !== 'object') {
      continue;
    }
    for (const [propName, propValue] of Object.entries<any>(props)) {
      if (!/Role(Arn)?$/i.test(propName) && propName !== 'ServiceToken') {
        continue;
      }
      const resolved = resolveToIdentity(propValue, physicalIdByLogicalId);
      if (!resolved) {
        continue;
      }
      const description = `${logicalId} (via ${propName})`;
      if (propName === 'ServiceToken') {
        // The backing function's role-session name is the function name.
        add(functionNameFromArnOrName(resolved), logicalId, description);
      } else {
        add(resolved, logicalId, description);
        add(nameSegment(resolved), logicalId, description);
      }
    }
  }

  return identities;
}

/**
 * The trailing name segment of an ARN-shaped identifier (e.g. the role name out of a role
 * ARN), or `undefined` when the value has no path to strip.
 */
function nameSegment(value: string): string | undefined {
  if (!value.includes('/')) {
    return undefined;
  }
  const segment = value.split('/').pop();
  return segment && segment !== value ? segment : undefined;
}

/**
 * Resolve a template property value to a matchable identity string: literals pass through,
 * `Ref`/`Fn::GetAtt` resolve via the resource's physical ID.
 */
function resolveToIdentity(value: any, physicalIdByLogicalId: Map<string, string>): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  const referenced = serviceTokenReferencedLogicalId(value);
  return referenced ? physicalIdByLogicalId.get(referenced) : undefined;
}

interface ParsedCloudTrailEvent {
  readonly eventTime?: Date;
  readonly eventSource?: string;
  readonly eventName?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;

  /**
   * All ARNs/identifiers in the event that could tie it to a stack identity.
   */
  readonly identityStrings: string[];
}

interface SweepResult {
  readonly events: ParsedCloudTrailEvent[];
  readonly truncated: boolean;
}

/**
 * One unfiltered `LookupEvents` sweep over the window, filtered to errored events.
 *
 * Failures of the lookup itself are not diagnosis results: an inaccessible CloudTrail is a
 * tooling problem, so it is reported as an IoHost warning (with the missing-permission hint
 * when applicable) and the investigation returns `undefined`.
 */
async function sweepCloudTrail(
  cloudTrail: ICloudTrailClient,
  windowStart: Date,
  windowEnd: Date,
  ioHelper: IoHelper,
): Promise<SweepResult | undefined> {
  const events: ParsedCloudTrailEvent[] = [];
  let truncated = false;
  try {
    let nextToken: string | undefined;
    let pages = 0;
    do {
      const resp = await cloudTrail.lookupEvents({
        StartTime: windowStart,
        EndTime: windowEnd,
        MaxResults: 50,
        NextToken: nextToken,
      });
      pages++;
      for (const e of resp.Events ?? []) {
        const parsed = parseCloudTrailEvent(e.CloudTrailEvent);
        if (parsed?.errorCode) {
          events.push(parsed);
        }
      }
      nextToken = resp.NextToken;
      if (nextToken && pages >= MAX_SWEEP_PAGES) {
        truncated = true;
        break;
      }
    } while (nextToken);
  } catch (e: any) {
    if (isAccessDeniedError(e)) {
      await ioHelper.defaults.warn(
        'Could not query CloudTrail for control-plane errors: the lookup role is missing the ' +
        '`cloudtrail:LookupEvents` permission. Grant it to surface errors (e.g. AccessDenied) ' +
        'that resource logs may not show.',
      );
    } else {
      await ioHelper.defaults.debug(`CloudTrail investigation: lookup failed: ${e.message}`);
    }
    return undefined;
  }
  return { events, truncated };
}

/**
 * Attribute errored events to stack resources.
 *
 * An event is correlated when any stack identity appears in one of the event's identity
 * strings (`userIdentity` ARNs, `inScopeOf.credentialsIssuedTo`, `resources[].ARN`).
 * Notably, errored calls made by the deploying principal itself carry none of these, which
 * is correct: their errors are already in the resource's status reason.
 */
function correlateEvents(
  events: ParsedCloudTrailEvent[],
  identities: StackIdentity[],
): Array<{ event: ParsedCloudTrailEvent; identity: StackIdentity }> {
  const ret: Array<{ event: ParsedCloudTrailEvent; identity: StackIdentity }> = [];
  for (const event of events) {
    const identity = identities.find((i) => event.identityStrings.some((s) => s.includes(i.key)));
    if (identity) {
      ret.push({ event, identity });
    }
  }
  return ret;
}

/**
 * Deduplicate and format correlated events for presentation.
 *
 * Retries and polling produce runs of identical errors; collapse by
 * `(eventSource, eventName, errorCode)` keeping the earliest occurrence (the call closest to
 * the root cause), present earliest-first, and cap the list — disclosing what was collapsed
 * or cut rather than silently presenting a partial answer as complete.
 */
function presentEvents(
  correlated: Array<{ event: ParsedCloudTrailEvent; identity: StackIdentity }>,
): CorrelatedCloudTrailError[] {
  const byKey = new Map<string, { event: ParsedCloudTrailEvent; identity: StackIdentity; count: number }>();
  for (const c of correlated) {
    const key = `${c.event.eventSource}|${c.event.eventName}|${c.event.errorCode}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...c, count: 1 });
    } else {
      existing.count++;
      if (c.event.eventTime && existing.event.eventTime && c.event.eventTime < existing.event.eventTime) {
        byKey.set(key, { event: c.event, identity: existing.identity, count: existing.count });
      }
    }
  }

  const distinct = [...byKey.values()].sort(
    (a, b) => (a.event.eventTime?.valueOf() ?? 0) - (b.event.eventTime?.valueOf() ?? 0),
  );

  const ret: CorrelatedCloudTrailError[] = distinct.slice(0, MAX_EVENTS_SHOWN).map((c) => ({
    logicalId: c.identity.logicalId,
    eventTime: c.event.eventTime,
    message: formatEvent(c.event, c.count),
  }));

  if (distinct.length > MAX_EVENTS_SHOWN) {
    ret.push({
      logicalId: distinct[MAX_EVENTS_SHOWN].identity.logicalId,
      message: `(${distinct.length - MAX_EVENTS_SHOWN} more distinct error event(s) not shown)`,
    });
  }
  return ret;
}

function formatEvent(event: ParsedCloudTrailEvent, count: number): string {
  const occurrences = count > 1 ? ` (${count} occurrences, earliest shown)` : '';
  const message = event.errorMessage ? ` — ${event.errorMessage}` : '';
  return `${event.errorCode} on ${event.eventSource ?? '?'}:${event.eventName ?? '?'}${message}${occurrences}`;
}

/** Parse the `CloudTrailEvent` JSON blob into the fields we care about. */
function parseCloudTrailEvent(json: string | undefined): ParsedCloudTrailEvent | undefined {
  if (!json) {
    return undefined;
  }
  try {
    const obj = JSON.parse(json);
    const identityStrings = [
      obj.userIdentity?.arn,
      obj.userIdentity?.sessionContext?.sessionIssuer?.arn,
      obj.userIdentity?.inScopeOf?.credentialsIssuedTo,
      ...(Array.isArray(obj.resources) ? obj.resources.map((r: any) => r?.ARN) : []),
    ].filter((s: any): s is string => typeof s === 'string');
    return {
      eventTime: typeof obj.eventTime === 'string' ? new Date(obj.eventTime) : undefined,
      eventSource: typeof obj.eventSource === 'string' ? obj.eventSource : undefined,
      eventName: typeof obj.eventName === 'string' ? obj.eventName : undefined,
      errorCode: typeof obj.errorCode === 'string' ? obj.errorCode : undefined,
      errorMessage: typeof obj.errorMessage === 'string' ? obj.errorMessage : undefined,
      identityStrings,
    };
  } catch {
    return undefined;
  }
}

/**
 * Whether an error from an AWS SDK call is an authorization failure. CloudTrail raises
 * `AccessDeniedException`; other services phrase it as `AccessDenied`, so match both.
 */
function isAccessDeniedError(e: any): boolean {
  const name = e?.name ?? e?.Code ?? '';
  return name === 'AccessDenied' || name === 'AccessDeniedException';
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
      return undefined;
    }
    return deserializeStructure(resp.TemplateBody);
  } catch (e: any) {
    await debug(`CloudTrail investigation: failed to read template: ${e.message}`);
    return undefined;
  }
}
