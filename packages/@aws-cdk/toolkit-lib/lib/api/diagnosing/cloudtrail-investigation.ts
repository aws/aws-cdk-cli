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
 * client-side: an event belongs to the stack when its *calling principal* carries a known
 * stack identity (a physical ID, an IAM role referenced by resource properties, or a
 * custom-resource backing function) as a whole ARN segment. Matching only the caller — never
 * the resources a call touched — keeps unrelated principals' activity against stack resources
 * out; a missed correlation degrades to "no events found", not a wrong attribution.
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
  const { shown, omitted } = presentEvents(correlated);

  const notes: string[] = [];
  if (sweep.truncated) {
    notes.push(`(only the most recent ${sweep.eventsChecked} CloudTrail events in the window were checked)`);
  }
  if (omitted > 0) {
    notes.push(`(${omitted} more distinct CloudTrail error event(s) not shown)`);
  }
  // Delivery latency applies whether or not something was already found: the fatal event may
  // still be in flight while an earlier, benign error has already been delivered.
  if (Date.now() - Math.max(...timestamps) < DELIVERY_LATENCY_MS) {
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
 * Build the set of identities that tie CloudTrail events back to this stack:
 *
 * - physical IDs of all stack resources (a Lambda's role-session name is its function name;
 *   role physical IDs appear in assumed-role session ARNs);
 * - IAM roles referenced by resource properties named `Role`/`RoleArn`/`ServiceToken` at any
 *   depth in the template (services acting on a resource's behalf assume these; the role
 *   *name* — not ARN — is embedded in the resulting session ARN, so bare names are indexed
 *   too).
 *
 * Best-effort: if the resource listing fails, template-derived identities (e.g. a literal
 * ServiceToken ARN) are still collected.
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
      identities.push({ key, stackArn, logicalId, description });
    }
  };

  const physicalIdByLogicalId = new Map<string, string>();
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
    // Not fatal: template-derived identities below don't need the physical IDs (literal
    // ARNs/names resolve on their own; only Ref/GetAtt references do).
    await debug(`CloudTrail investigation: failed to list stack resources: ${e.message}`);
  }

  const template = await getStackTemplate(cfn, stackArn, debug);
  for (const [logicalId, resource] of Object.entries<any>(template?.Resources ?? {})) {
    for (const { propName, value } of collectPrincipalProperties(resource?.Properties)) {
      const resolved = resolveToIdentity(value, physicalIdByLogicalId);
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
 * Collect properties that reference a calling principal — `Role`/`RoleArn` (any depth, since
 * many resources nest role references, e.g. Firehose destination configurations or
 * EventBridge targets) and the top-level `ServiceToken` of custom resources.
 */
function collectPrincipalProperties(props: any, depth = 0): Array<{ propName: string; value: any }> {
  if (!props || typeof props !== 'object' || depth > 10) {
    return [];
  }
  const ret: Array<{ propName: string; value: any }> = [];
  for (const [key, value] of Object.entries(props)) {
    if (/Role(Arn)?$/i.test(key) || key === 'ServiceToken') {
      ret.push({ propName: key, value });
    }
    ret.push(...collectPrincipalProperties(value, depth + 1));
  }
  return ret;
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
 * `Ref`/`Fn::GetAtt` resolve via the resource's physical ID, and an `Fn::Sub` role ARN
 * yields its role name when that segment is literal. Unresolvable expressions (e.g.
 * `Fn::ImportValue`) return `undefined` — a missed identity degrades to "no events found".
 */
function resolveToIdentity(value: any, physicalIdByLogicalId: Map<string, string>): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  const referenced = serviceTokenReferencedLogicalId(value);
  if (referenced) {
    return physicalIdByLogicalId.get(referenced);
  }
  const sub = value?.['Fn::Sub'];
  if (typeof sub === 'string') {
    if (!sub.includes('${')) {
      return sub;
    }
    // Common shape: 'arn:aws:iam::${AWS::AccountId}:role/<literal-name>' — the name segment
    // is all we need for matching, and it is often free of substitutions.
    const name = nameSegment(sub);
    if (name && !name.includes('${')) {
      return name;
    }
  }
  return undefined;
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
  return { events, eventsChecked, truncated };
}

/**
 * Attribute errored events to stack resources.
 *
 * An event is correlated when a stack identity appears as a whole segment of one of the
 * event's calling-principal ARNs. Errored calls made by the deploying principal itself carry
 * no stack identity, which is correct: their errors are already in the resource's status
 * reason.
 */
function correlateEvents(
  events: ParsedCloudTrailEvent[],
  identities: StackIdentity[],
): Array<{ event: ParsedCloudTrailEvent; identity: StackIdentity }> {
  const ret: Array<{ event: ParsedCloudTrailEvent; identity: StackIdentity }> = [];
  for (const event of events) {
    const identity = identities.find((i) => event.callerIdentityStrings.some((s) => identityMatches(s, i.key)));
    if (identity) {
      ret.push({ event, identity });
    }
  }
  return ret;
}

/**
 * Whether an identity key occurs in an ARN as a whole segment.
 *
 * Segment-anchored on purpose: a bare substring test would let a key that is a prefix of
 * another resource's name (e.g. `my-svc-1` inside `my-svc-10`) claim that resource's events.
 * Single-segment keys (names, physical IDs) must equal a full `:`/`/`-delimited segment;
 * multi-segment keys (ARNs, path-shaped IDs) must be bounded by delimiters or string ends.
 */
function identityMatches(haystack: string, key: string): boolean {
  if (haystack === key) {
    return true;
  }
  if (!key.includes(':') && !key.includes('/')) {
    return haystack.split(/[:/]/).includes(key);
  }
  const isBoundary = (c: string | undefined) => c === undefined || c === ':' || c === '/';
  let idx = haystack.indexOf(key);
  while (idx !== -1) {
    if (isBoundary(haystack[idx - 1]) && isBoundary(haystack[idx + key.length])) {
      return true;
    }
    idx = haystack.indexOf(key, idx + 1);
  }
  return false;
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
      obj.userIdentity?.inScopeOf?.credentialsIssuedTo,
    ].filter((s: any): s is string => typeof s === 'string');
    return {
      eventTime: typeof obj.eventTime === 'string' ? new Date(obj.eventTime) : undefined,
      eventSource: typeof obj.eventSource === 'string' ? obj.eventSource : undefined,
      eventName: typeof obj.eventName === 'string' ? obj.eventName : undefined,
      errorCode: typeof obj.errorCode === 'string' ? obj.errorCode : undefined,
      errorMessage: typeof obj.errorMessage === 'string' ? obj.errorMessage : undefined,
      callerIdentityStrings,
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
