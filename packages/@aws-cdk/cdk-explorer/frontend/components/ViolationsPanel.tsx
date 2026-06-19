import Box from '@cloudscape-design/components/box';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import * as React from 'react';
import { displaySeverity, severityHexColor, severityRank } from '../../lib/web/severity';
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

function ViolationItem({ violation }: { readonly violation: WebViolation }): JSX.Element {
  const severity = displaySeverity(violation);
  const count = violation.occurrences.length;
  return (
    <ExpandableSection
      variant="footer"
      headerText={
        <span style={HEADER_STYLE}>
          <span style={severityStyle(severity)}>[{severity.toUpperCase()}]</span>
          <span style={RULE_STYLE}>{violation.ruleName}</span>
          <span style={META_STYLE}>
            {count} {count === 1 ? 'construct' : 'constructs'} {'·'} {violation.source}
          </span>
        </span>
      }
    >
      <SpaceBetween size="xxs">
        <Box>{violation.description}</Box>
        {violation.suggestedFix && <Box variant="small">Suggested fix: {violation.suggestedFix}</Box>}
        {violation.occurrences.map((occ, i) => (
          <Box key={`${occ.constructPath}:${i}`} variant="small" color="text-status-inactive">
            {occ.constructPath}
            {occ.logicalId ? ` → ${occ.logicalId}` : ''}
            {occ.templateFile ? ` (${occ.templateFile})` : ''}
          </Box>
        ))}
      </SpaceBetween>
    </ExpandableSection>
  );
}

function severityStyle(severity: string | undefined): React.CSSProperties {
  return { color: severityHexColor(severity), fontWeight: 700 };
}

const SCROLL_STYLE: React.CSSProperties = { maxHeight: '100%', overflowY: 'auto' };
const HEADER_STYLE: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '8px' };
const RULE_STYLE: React.CSSProperties = { fontWeight: 700 };
const META_STYLE: React.CSSProperties = { color: '#5f6b7a', fontWeight: 400, fontSize: '12px' };
