import Box from '@cloudscape-design/components/box';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import * as React from 'react';
import { displaySeverity, severityHexColor, severityRank } from '../../lib/web/severity';
import type { WebViolation, WebViolationOccurrence } from '../api';
import type { NavigateHandler } from '../nav-types';

interface ViolationsPanelProps {
  readonly violations: readonly WebViolation[];
  readonly onNavigate: NavigateHandler;
}

export function ViolationsPanel({ violations, onNavigate }: ViolationsPanelProps): JSX.Element {
  if (violations.length === 0) {
    return <StatusIndicator type="success">No policy violations.</StatusIndicator>;
  }
  const sorted = [...violations].sort((a, b) => severityRank(displaySeverity(a)) - severityRank(displaySeverity(b)));
  return (
    <div style={SCROLL_STYLE}>
      <SpaceBetween size="xs">
        {sorted.map((violation, i) => (
          <ViolationItem key={`${violation.source}:${violation.ruleName}:${i}`} violation={violation} onNavigate={onNavigate} />
        ))}
      </SpaceBetween>
    </div>
  );
}

function ViolationItem({ violation, onNavigate }: { readonly violation: WebViolation; readonly onNavigate: NavigateHandler }): JSX.Element {
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
          <OccurrenceRow key={`${occ.constructPath}:${i}`} occurrence={occ} severity={severity} onNavigate={onNavigate} />
        ))}
      </SpaceBetween>
    </ExpandableSection>
  );
}

function OccurrenceRow({ occurrence, severity, onNavigate }: {
  readonly occurrence: WebViolationOccurrence;
  readonly severity: string;
  readonly onNavigate: NavigateHandler;
}): JSX.Element {
  const handleDoubleClick = React.useCallback(() => {
    if (!occurrence.sourceLocation && !occurrence.templateFile) return;
    onNavigate({
      sourceLocation: occurrence.sourceLocation,
      templateFile: occurrence.templateFile,
      logicalId: occurrence.logicalId,
      propertyPaths: occurrence.propertyPaths,
      color: severityHexColor(severity),
    });
  }, [occurrence, severity, onNavigate]);

  return (
    <Box variant="small" color="text-status-inactive">
      <span style={OCCURRENCE_STYLE} onDoubleClick={handleDoubleClick} title="Double-click to navigate">
        {occurrence.constructPath}
        {occurrence.logicalId ? ` → ${occurrence.logicalId}` : ''}
        {occurrence.templateFile ? ` (${occurrence.templateFile})` : ''}
      </span>
    </Box>
  );
}

function severityStyle(severity: string): React.CSSProperties {
  return { color: severityHexColor(severity), fontWeight: 700 };
}

const SCROLL_STYLE: React.CSSProperties = { maxHeight: '100%', overflowY: 'auto' };
const HEADER_STYLE: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '8px' };
const RULE_STYLE: React.CSSProperties = { fontWeight: 700 };
const META_STYLE: React.CSSProperties = { color: '#5f6b7a', fontWeight: 400, fontSize: '12px' };
const OCCURRENCE_STYLE: React.CSSProperties = { cursor: 'default' };
