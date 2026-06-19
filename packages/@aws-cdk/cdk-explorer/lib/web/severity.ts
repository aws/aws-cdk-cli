/**
 * Severity vocabulary for CDK policy violations, shared by the server (ranking
 * violations onto construct-tree nodes) and the SPA (sorting and coloring the
 * violations panel) so the rules live in exactly one place.
 */

import type { WebViolation, WebViolationSeverity } from './protocol';

/** Severities CDK policy validation reports natively. */
const KNOWN_SEVERITIES = new Set<string>(['fatal', 'error', 'warning', 'info', 'custom']);

/**
 * Classify a severity from a raw, unvalidated policy-validation report into the
 * wire model. Known values and a missing severity pass through unchanged; a
 * value outside the set is mapped to `custom`, keeping the raw value as the
 * label, so a newer or non-conforming report can never produce a wire value
 * that violates {@link WebViolationSeverity}.
 */
export function classifyReportSeverity(
  severity: string | undefined,
  customSeverity: string | undefined,
): { readonly severity?: WebViolationSeverity; readonly customSeverity?: string } {
  if (severity !== undefined && !KNOWN_SEVERITIES.has(severity)) {
    return { severity: 'custom', customSeverity: customSeverity ?? severity };
  }
  return { severity: severity as WebViolationSeverity | undefined, customSeverity };
}

/** Lower-cased severity so 'Error'/'ERROR'/'error' all match (mirroring cdk validate). */
function normalize(severity: string | undefined): string {
  return (severity ?? '').toLowerCase();
}

/**
 * Severity label for display: a plugin's custom label, else the reported
 * severity, else 'warning' (cdk validate's default for severity-less plugins
 * like CfnGuard).
 */
export function displaySeverity(violation: Pick<WebViolation, 'severity' | 'customSeverity'>): string {
  return violation.customSeverity ?? violation.severity ?? 'warning';
}

const SEVERITY_RANK: Record<string, number> = { fatal: 0, error: 1, warning: 2, info: 3 };

/**
 * Sort rank for a severity label; lower sorts first. Custom and unrecognized
 * labels rank just after `info`, matching cdk validate's handling of unknown
 * severities.
 */
export function severityRank(severity: string | undefined): number {
  return SEVERITY_RANK[normalize(severity)] ?? 4;
}

const SEVERITY_HEX: Record<string, string> = {
  fatal: '#d91515',
  error: '#e07700',
  warning: '#8d6605',
  info: '#0972d3',
};

/**
 * Text color for a severity label, mirroring cdk validate (fatal red, error
 * orange, warning amber, info blue); custom and unrecognized labels render gray.
 */
export function severityHexColor(severity: string | undefined): string {
  return SEVERITY_HEX[normalize(severity)] ?? '#5f6b7a';
}
