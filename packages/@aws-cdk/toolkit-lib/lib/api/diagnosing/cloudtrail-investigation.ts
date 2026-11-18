import { assumedRoleSessionName, identityMatches, nameSegment } from './resource-identifiers';
import type { AdditionalDiagnosticContext } from '../../actions/diagnose';
import type { ICloudFormationClient, ICloudTrailClient, SDK } from '../aws-auth/sdk';
import { isAccessDeniedError } from '../aws-auth/util';
import type { IoHelper } from '../io/private/io-helper';
import type { OperationPrincipal, ResourceError } from '../stack-events/resource-errors';
import { PRINCIPAL_RESOURCE_TYPES } from '../stack-events/resource-errors';

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
 * client-side: an event belongs to the stack when its *calling principal* carries a known
 * stack identity (the physical ID of a role or Lambda function the stack operation involved)
 * as a whole ARN segment. Matching only the caller — never the resources a
 * call touched — keeps unrelated principals' activity against stack resources out; a missed
 * correlation degrades to "no events found", not a wrong attribution.
 *
 * Roles the stack merely references (imported by ARN or name) are deliberately not
 * identities: they may be shared with resources outside the stack, whose calls would then be
 * attributed to it. Calls made with such a role still correlate when the caller itself is a
 * stack resource (e.g. a stack Lambda, by its session name).
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
 * Minimum length for an identity key. Matching is by whole ARN segment (never bare
 * substring), so this only guards against degenerate keys — empty or so short and generic
 * that an exact segment collision with an unrelated principal is conceivable.
 */
const MIN_IDENTITY_KEY_LENGTH = 4;

/**
 * If the failure is more recent than this, events may not have been delivered yet
 * (CloudTrail delivery averages ~5 minutes, up to 15), so more may appear on a later run.
 */
const DELIVERY_LATENCY_MS = 15 * 60 * 1000;

/**
 * Error codes CloudTrail records for a successful dry-run call ("the request would have
 * succeeded, but the DryRun option is set"). Some services issue these as permission pre-checks on
 * a resource's behalf and they are not failures.
 *
 * Non-exhaustive: covers the services whose dry runs appear during deployments.
 */
const DRY_RUN_SUCCESS_ERROR_CODES = [
  'DryRunOperationException', // KMS, Kinesis Data Streams
  'Client.DryRunOperation', // EC2 (e.g. Lambda's ENI pre-checks for VPC-attached functions)
];

/**
 * An identity that ties CloudTrail events back to a stack resource.
 */
interface StackIdentity {
  /**
   * The segment value to look for in the event's calling-principal ARNs.
   */
  readonly key: string;

  /**
   * The stack the identified resource belongs to.
   */
  readonly stackArn: string;

  /**
   * Logical ID of the stack resource this identity belongs to.
   */
  readonly logicalId: string;

  /**
   * Human-readable description of the resource, used to attribute events whose resource is
   * not itself among the reported problems.
   */
  readonly description: string;
}

/**
 * A CloudTrail error event correlated to a stack resource.
 */
export interface CorrelatedCloudTrailError {
  /**
   * The stack of the resource the event was attributed to.
   */
  readonly stackArn: string;

  /**
   * Logical ID of the stack resource the event was attributed to.
   */
  readonly logicalId: string;

  /**
   * Human-readable description of the attributed resource.
   */
  readonly description: string;

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
   * Extra notes about the scan itself (truncation, overflow, delivery-latency hint).
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
  operationPrincipals: readonly OperationPrincipal[] = [],
): Promise<CloudTrailInvestigation | undefined> {
  const debug = (msg: string) => ioHelper.defaults.debug(msg);

  // Without failure timestamps (change-set / early-validation errors) we cannot bound the
  // sweep; an unbounded window would surface unrelated account activity.
  const timestamps = errors.map((e) => e.timestamp?.valueOf()).filter((t): t is number => t !== undefined);
  if (timestamps.length === 0) {
    await debug('CloudTrail investigation: no failure timestamps to bound the window');
    return undefined;
  }

  const windowStart = new Date(Math.min(...timestamps) - SWEEP_WINDOW_BEFORE_MS);
  // All failure events precede the rollback that follows them, so ending the window shortly
  // after the last failure event naturally excludes rollback/teardown noise.
  const windowEnd = new Date(Math.max(...timestamps) + SWEEP_WINDOW_AFTER_MS);

  const cfn = sdk.cloudFormation();
  const identities: StackIdentity[] = [];
  for (const stackArn of new Set(errors.map((e) => e.stackArn).filter((s) => !!s))) {
    identities.push(...await buildStackIdentitySet(cfn, stackArn, operationPrincipals, debug));
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
  const { shown, omitted } = presentEvents(correlated);

  const notes: string[] = [];
  if (sweep.truncated) {
    notes.push(`(only the most recent ${sweep.eventsChecked} CloudTrail events in the window were checked)`);
  }
  if (omitted > 0) {
    notes.push(`(${omitted} more distinct CloudTrail error event(s) not shown)`);
  }
  // Delivery latency applies whether or not something was already found: the fatal event may
  // still be in flight while an earlier, benign error has already been delivered. Once
  // CloudTrail has delivered any event from after the window, assume the window is complete.
  if (Date.now() - Math.max(...timestamps) < DELIVERY_LATENCY_MS && !await deliveredPast(sdk.cloudTrail(), windowEnd, ioHelper)) {
    notes.push(
      'CloudTrail delivery can lag up to 15 minutes behind the failure; ' +
      're-run `cdk diagnose` in a few minutes to check for additional control-plane errors (e.g. AccessDenied).',
    );
  }

  return { errors: shown, notes };
}

/**
 * A CloudTrail context attributed to a specific stack resource.
 */
export interface AttributedCloudTrailContext {
  /**
   * The stack of the resource the context belongs to.
   */
  readonly stackArn: string;

  /**
   * Logical ID of the resource the context belongs to.
   */
  readonly logicalId: string;

  /**
   * Human-readable description of the resource, for labeling the context when it cannot be
   * attached to that resource's own problem entry.
   */
  readonly description: string;

  /**
   * The diagnostic context to attach.
   */
  readonly context: AdditionalDiagnosticContext;
}

/**
 * Group a CloudTrail investigation's findings into per-resource diagnostic contexts.
 *
 * Grouping is per (stack, logical ID) — logical IDs alone are not unique across nested
 * stacks. The caller attaches each context to the matching problem, or presents it with its
 * `description` label when the resource is not itself among the problems.
 */
export function attributedCloudTrailContexts(investigation: CloudTrailInvestigation): AttributedCloudTrailContext[] {
  const byResource = new Map<string, { stackArn: string; logicalId: string; description: string; messages: string[] }>();
  for (const e of investigation.errors) {
    const key = `${e.stackArn}|${e.logicalId}`;
    const existing = byResource.get(key);
    if (existing) {
      existing.messages.push(e.message);
    } else {
      byResource.set(key, { stackArn: e.stackArn, logicalId: e.logicalId, description: e.description, messages: [e.message] });
    }
  }

  return [...byResource.values()].map((r) => ({
    stackArn: r.stackArn,
    logicalId: r.logicalId,
    description: r.description,
    context: { source: 'CloudTrail Errors', messages: r.messages },
  }));
}

/**
 * Build the set of identities that tie CloudTrail events back to this stack: the physical
 * IDs of the roles and Lambda functions involved in the stack operation.
 *
 * - A role appears in the session ARN of whoever assumes it (a resource's own code, or a
 *   service acting on the resource's behalf with a generated session name).
 * - A Lambda function is the session name, and `inScopeOf` resource, of calls its code
 *   makes; this also covers custom-resource handlers in the stack.
 *
 * The set is the union of the roles and functions currently in the stack and those seen in
 * the operation's stack events. The latter include resources the operation created and then
 * rolled back, which no longer show up in the resource listing. Together they are an upper
 * bound on the stack's own principals during the operation.
 *
 * Roles the stack merely references (imported) never appear in either source, so they are
 * not identities. Best-effort: if the resource listing fails, the event-derived principals
 * are still used.
 */
async function buildStackIdentitySet(
  cfn: ICloudFormationClient,
  stackArn: string,
  operationPrincipals: readonly OperationPrincipal[],
  debug: (msg: string) => Promise<void>,
): Promise<StackIdentity[]> {
  const identities: StackIdentity[] = [];
  const seen = new Set<string>();
  const add = (key: string | undefined, logicalId: string, resourceType: string) => {
    if (key && key.length >= MIN_IDENTITY_KEY_LENGTH && !seen.has(key)) {
      seen.add(key);
      identities.push({ key, stackArn, logicalId, description: `${logicalId} (${resourceType})` });
    }
  };
  const addPrincipal = (logicalId: string, resourceType: string, physicalId: string) => {
    if (!PRINCIPAL_RESOURCE_TYPES.includes(resourceType)) {
      return;
    }
    add(physicalId, logicalId, resourceType);
    // ARN-shaped physical IDs also get their trailing name segment indexed: session ARNs
    // embed names, not ARNs.
    add(nameSegment(physicalId), logicalId, resourceType);
  };

  try {
    for (const r of await cfn.listStackResources({ StackName: stackArn })) {
      if (r.LogicalResourceId && r.PhysicalResourceId && r.ResourceType) {
        addPrincipal(r.LogicalResourceId, r.ResourceType, r.PhysicalResourceId);
      }
    }
  } catch (e: any) {
    await debug(`CloudTrail investigation: failed to list stack resources: ${e.message}`);
  }

  for (const p of operationPrincipals) {
    if (p.stackArn === stackArn) {
      addPrincipal(p.logicalId, p.resourceType, p.physicalId);
    }
  }

  return identities;
}

interface ParsedCloudTrailEvent {
  readonly eventTime?: Date;
  readonly eventSource?: string;
  readonly eventName?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;

  /**
   * ARNs identifying the CALLING principal. Deliberately excludes `resources[]` (what the
   * call touched): matching on touched resources would attribute unrelated principals'
   * errored calls against stack resources to the stack.
   */
  readonly callerIdentityStrings: string[];

  /**
   * ARN of the resource the caller's credentials were issued to
   * (`userIdentity.inScopeOf.credentialsIssuedTo`, e.g. the Lambda function that made the call).
   */
  readonly credentialsIssuedTo?: string;
}

interface SweepResult {
  /**
   * The errored events found in the window.
   */
  readonly events: ParsedCloudTrailEvent[];

  /**
   * Total events examined (errored or not) — the number the truncation note discloses.
   */
  readonly eventsChecked: number;

  readonly truncated: boolean;
}

/**
 * One unfiltered `LookupEvents` sweep over the window, filtered to errored events (excluding
 * successful dry runs).
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
  let eventsChecked = 0;
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
        eventsChecked++;
        const parsed = parseCloudTrailEvent(e.CloudTrailEvent);
        if (parsed?.errorCode && !DRY_RUN_SUCCESS_ERROR_CODES.includes(parsed.errorCode)) {
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
  return { events, eventsChecked, truncated };
}

/**
 * Whether CloudTrail has delivered any event that happened at or after `time`.
 *
 * CloudTrail does not deliver events in strict `eventTime` order, so this is a heuristic for
 * "events up to `time` have been delivered", not a guarantee. A failed probe answers `false`:
 * the hint to re-run is the safe default.
 */
async function deliveredPast(cloudTrail: ICloudTrailClient, time: Date, ioHelper: IoHelper): Promise<boolean> {
  try {
    const resp = await cloudTrail.lookupEvents({ StartTime: time, EndTime: new Date(), MaxResults: 1 });
    return (resp.Events ?? []).length > 0;
  } catch (e: any) {
    await ioHelper.defaults.debug(`CloudTrail investigation: delivery probe failed: ${e.message}`);
    return false;
  }
}

/**
 * Attribute errored events to stack resources.
 *
 * An event is correlated when a stack identity appears as a whole segment of one of the
 * event's calling-principal ARNs. Errored calls made by the deploying principal itself carry
 * no stack identity, which is correct: their errors are already in the resource's status
 * reason.
 *
 * A single event can match several identities — an assumed-role session ARN
 * (`arn:...:assumed-role/<roleName>/<sessionName>`) contains both the role and, for
 * Lambda-made calls, the function name as the session name. Attribution must not depend on
 * identity-set insertion order (which follows the unordered `ListStackResources`
 * response), so the most specific match wins: the session-name segment identifies the actual
 * caller (the function), the role only who it borrowed permissions from; ties fall back to
 * the longest key.
 */
function correlateEvents(
  events: ParsedCloudTrailEvent[],
  identities: StackIdentity[],
): Array<{ event: ParsedCloudTrailEvent; identity: StackIdentity }> {
  const ret: Array<{ event: ParsedCloudTrailEvent; identity: StackIdentity }> = [];
  for (const event of events) {
    const identity = mostSpecificMatch(event, identities);
    if (identity) {
      ret.push({ event, identity });
    }
  }
  return ret;
}

/**
 * The best-matching identity for an event: session-name matches beat other matches, longer
 * keys beat shorter ones (a longer segment is a more specific name).
 */
function mostSpecificMatch(event: ParsedCloudTrailEvent, identities: StackIdentity[]): StackIdentity | undefined {
  const sessionNames = new Set(
    event.callerIdentityStrings
      .map(assumedRoleSessionName)
      .filter((s): s is string => !!s),
  );

  const callers = event.credentialsIssuedTo ? [event.credentialsIssuedTo] : event.callerIdentityStrings;

  let best: StackIdentity | undefined;
  let bestRank = -1;
  for (const identity of identities) {
    if (!callers.some((s) => identityMatches(s, identity.key))) {
      continue;
    }
    // Two-tier rank: session-name matches sort above everything else; key length breaks ties.
    const rank = (sessionNames.has(identity.key) ? 1_000_000 : 0) + identity.key.length;
    if (rank > bestRank) {
      best = identity;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Deduplicate and format correlated events for presentation.
 *
 * Retries and polling produce runs of identical errors; collapse by
 * `(eventSource, eventName, errorCode)` keeping the earliest occurrence (the call closest to
 * the root cause), present earliest-first, and cap the list. The number of distinct events
 * cut by the cap is returned for the caller to disclose.
 */
function presentEvents(
  correlated: Array<{ event: ParsedCloudTrailEvent; identity: StackIdentity }>,
): { shown: CorrelatedCloudTrailError[]; omitted: number } {
  const byKey = new Map<string, { event: ParsedCloudTrailEvent; identity: StackIdentity; count: number }>();
  for (const c of correlated) {
    const key = `${c.event.eventSource}|${c.event.eventName}|${c.event.errorCode}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...c, count: 1 });
    } else {
      existing.count++;
      if (c.event.eventTime && existing.event.eventTime && c.event.eventTime < existing.event.eventTime) {
        // Keep the earlier event AND its own attribution — the first-seen occurrence may
        // have been made by a different resource's principal.
        existing.event = c.event;
        existing.identity = c.identity;
      }
    }
  }

  const distinct = [...byKey.values()].sort(
    (a, b) => (a.event.eventTime?.valueOf() ?? 0) - (b.event.eventTime?.valueOf() ?? 0),
  );

  const shown = distinct.slice(0, MAX_EVENTS_SHOWN).map((c) => ({
    stackArn: c.identity.stackArn,
    logicalId: c.identity.logicalId,
    description: c.identity.description,
    eventTime: c.event.eventTime,
    message: formatEvent(c.event, c.count),
  }));

  return { shown, omitted: distinct.length - shown.length };
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
    const callerIdentityStrings = [
      obj.userIdentity?.arn,
      obj.userIdentity?.sessionContext?.sessionIssuer?.arn,
    ].filter((s: any): s is string => typeof s === 'string');
    const credentialsIssuedTo = obj.userIdentity?.inScopeOf?.credentialsIssuedTo;
    return {
      eventTime: typeof obj.eventTime === 'string' ? new Date(obj.eventTime) : undefined,
      eventSource: typeof obj.eventSource === 'string' ? obj.eventSource : undefined,
      eventName: typeof obj.eventName === 'string' ? obj.eventName : undefined,
      errorCode: typeof obj.errorCode === 'string' ? obj.errorCode : undefined,
      errorMessage: typeof obj.errorMessage === 'string' ? obj.errorMessage : undefined,
      callerIdentityStrings,
      credentialsIssuedTo: typeof credentialsIssuedTo === 'string' ? credentialsIssuedTo : undefined,
    };
  } catch {
    return undefined;
  }
}

