/** Pure parsers for resource identifiers used during failure diagnosis. */

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
export function logStreamNameFromPhysicalId(physicalId: string | undefined): string | undefined {
  return physicalId && /^\d{4}\/\d{2}\/\d{2}\/.+/.test(physicalId) ? physicalId : undefined;
}

export function ecsStoppedTasksConsoleUrl(region: string, cluster: string, serviceName: string): string {
  return `https://${region}.console.aws.amazon.com/ecs/v2/clusters/${cluster}/services/${serviceName}/tasks?status=STOPPED&region=${region}`;
}

/**
 * The trailing name segment of an ARN-shaped identifier (e.g. the role name out of a role
 * ARN), or `undefined` when the value has no path to strip.
 */
export function nameSegment(value: string): string | undefined {
  if (!value.includes('/')) {
    return undefined;
  }
  const segment = value.split('/').pop();
  return segment && segment !== value ? segment : undefined;
}

/**
 * The session-name segment of an assumed-role ARN
 * (`arn:...:sts::<account>:assumed-role/<roleName>/<sessionName>`), or `undefined` for any
 * other shape.
 *
 * The session name identifies the actual caller: a Lambda execution role's session name is
 * the function name, while services assuming a role on a resource's behalf generate one
 * (e.g. `awslambda_110_...`).
 */
export function assumedRoleSessionName(arn: string): string | undefined {
  return arn.match(/:assumed-role\/[^/]+\/(.+)$/)?.[1];
}

/**
 * Whether an identity key occurs in an ARN as a whole segment.
 *
 * Segment-anchored on purpose: a bare substring test would let a key that is a prefix of
 * another resource's name (e.g. `my-svc-1` inside `my-svc-10`) claim that resource's events.
 * Single-segment keys (names, physical IDs) must equal a full `:`/`/`-delimited segment;
 * multi-segment keys (ARNs, path-shaped IDs) must be bounded by delimiters or string ends.
 */
export function identityMatches(haystack: string, key: string): boolean {
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
