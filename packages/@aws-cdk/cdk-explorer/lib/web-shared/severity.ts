/**
 * Severity vocabulary for CDK policy violations, shared by the server (ranking
 * violations onto construct-tree nodes) and the SPA (sorting and coloring the
 * violations panel) so the rules live in exactly one place.
 */

import type { WebViolation, WebViolationSeverity } from './protocol';

/** Severities CDK policy validation reports natively. */
const KNOWN_SEVERITIES = new Set<string>(['fatal', 'error', 'warning', 'info', 'custom']);

/**
 * Coerce a report's severity into the wire model. aws-cdk-lib already emits standard
 * levels as-is and non-standard ones as `severity: 'custom'` with the raw label in
 * `customSeverity`. Since we read the report as untyped JSON, this also folds any
 * unrecognized `severity` string into `'custom'` (keeping the raw value as its label),
 * so the result can never be a value outside {@link WebViolationSeverity}.
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
function normalize(severity: string): string {
  return severity.toLowerCase();
}

/**
 * Severity label for display: a plugin's custom label, else the reported
 * severity, else 'warning' (cdk validate's default for severity-less plugins
 * like CfnGuard).
 */
export function displaySeverity(violation: Pick<WebViolation, 'severity' | 'customSeverity'>): string {
  return violation.customSeverity ?? violation.severity ?? 'warning';
}

const SEVERITY_RANK: Record<string, number> = { fatal: 0, error: 1, warning: 2, info: 3, neutral: 4 };

/**
 * Sort rank for a severity label; lower sorts first. Custom and unrecognized
 * labels rank just after `info`, matching cdk validate's handling of unknown
 * severities.
 */
export function severityRank(severity: string): number {
  return SEVERITY_RANK[normalize(severity)] ?? 4;
}

/**
 * Return the worst (highest-priority) severity from a list of severities. Lower ranks indicate more severe issues.
 */
export function worstSeverity(severities: string[]): string {
  return severities.reduce((worst, s) => {
    if (!worst) return s;
    return severityRank(s) < severityRank(worst) ? s : worst;
  }, 'neutral');
}

export function violationComparator(a: WebViolation, b: WebViolation): number {
  const aSev = severityRank(a.severity ?? 'neutral');
  const bSev = severityRank(b.severity ?? 'neutral');
  if (aSev !== bSev) {
    return aSev - bSev;
  }
  return a.description.localeCompare(b.description);
}
