import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import * as React from 'react';
import type { WebViolation } from '../api';

interface ViolationsPanelProps {
  readonly violations: readonly WebViolation[];
  readonly reportError?: string;
}

/**
 * Renders policy-validation violations like a Problems panel: sorted by
 * severity, each a collapsible row led by a colored severity indicator, with
 * the rule, affected-construct count, and plugin source.
 */
export function ViolationsPanel({ violations, reportError }: ViolationsPanelProps): JSX.Element {
  if (reportError) {
    return <Box color="text-status-error">Validation report failed to load: {reportError}</Box>;
  }
  if (violations.length === 0) {
    return <StatusIndicator type="success">No policy violations.</StatusIndicator>;
  }
  const sorted = [...violations].sort((a, b) => severityRank(displaySeverity(a)) - severityRank(displaySeverity(b)));
  return (
    <div style={SCROLL_STYLE}>
      <SpaceBetween size="xs">
        {sorted.map((violation, i) => (
          <ViolationItem key={`${violation.source}:${violation.ruleName}:${i}`} violation={violation} />
        ))}
      </SpaceBetween>
    </div>
  );
}

const SCROLL_STYLE: React.CSSProperties = { maxHeight: '55vh', overflowY: 'auto' };

function ViolationItem({ violation }: { readonly violation: WebViolation }): JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const count = violation.occurrences.length;
  return (
    <Box>
      <button type="button" style={HEADER_STYLE} aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
        <span style={CARET_STYLE}>{expanded ? '\u25be' : '\u25b8'}</span>
        <span style={severityStyle(displaySeverity(violation))}>[{displaySeverity(violation).toUpperCase()}]</span>
        <span style={RULE_STYLE}>{violation.ruleName}</span>
        <Box variant="span" color="text-status-inactive">
          {count} {count === 1 ? 'construct' : 'constructs'} \u00b7 {violation.source}
        </Box>
      </button>
      {expanded && (
        <Box padding={{ left: 'xl', top: 'xxs' }}>
          <SpaceBetween size="xxs">
            <Box>{violation.description}</Box>
            {violation.suggestedFix && <Box variant="small">Suggested fix: {violation.suggestedFix}</Box>}
            {violation.occurrences.map((occ, i) => (
              <Box key={`${occ.constructPath}:${i}`} variant="small" color="text-status-inactive">
                {occ.constructPath}
                {occ.logicalId ? ` \u2192 ${occ.logicalId}` : ''}
                {occ.templateFile ? ` (${occ.templateFile})` : ''}
              </Box>
            ))}
          </SpaceBetween>
        </Box>
      )}
    </Box>
  );
}

/** Lower-cased severity so 'Error'/'ERROR'/'error' all map (matching cdk validate). */
function normalize(severity: string | undefined): string {
  return (severity ?? '').toLowerCase();
}

/** Severity for display: a plugin's custom label, else the reported severity, else 'warning' (matching cdk validate's default for severity-less plugins like CfnGuard). */
function displaySeverity(violation: WebViolation): string {
  return violation.customSeverity ?? violation.severity ?? 'warning';
}

/** Severity text colors mirroring `cdk validate`'s scheme: fatal red, error orange, warning amber, info blue. */
const SEVERITY_HEX: Record<string, string> = {
  fatal: '#d91515',
  error: '#e07700',
  warning: '#8d6605',
  info: '#0972d3',
  custom: '#5f6b7a',
};
function severityStyle(severity: string | undefined): React.CSSProperties {
  return { color: SEVERITY_HEX[normalize(severity)] ?? '#5f6b7a', fontWeight: 700 };
}

const SEVERITY_RANK: Record<string, number> = { fatal: 0, error: 1, warning: 2, info: 3, custom: 4 };
function severityRank(severity: string | undefined): number {
  return SEVERITY_RANK[normalize(severity)] ?? 5;
}

const HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  width: '100%',
  textAlign: 'left',
};
const CARET_STYLE: React.CSSProperties = { width: '10px', fontSize: '10px', lineHeight: 1, color: 'inherit' };
const RULE_STYLE: React.CSSProperties = { fontWeight: 700 };
