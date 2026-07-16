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
  readonly filter?: string;
  readonly onClearFilter: () => void;
  readonly search: string;
}

export function ViolationsPanel({ violations, onNavigate, filter, search }: ViolationsPanelProps): JSX.Element {
  if (violations.length === 0) {
    return <StatusIndicator type="success">No policy violations.</StatusIndicator>;
  }

  const filtered = filterViolations(violations, filter, search);
  const sorted = [...filtered].sort((a, b) => severityRank(displaySeverity(a)) - severityRank(displaySeverity(b)));

  if (sorted.length === 0) {
    return <Box color="text-status-inactive">{filter ? 'No violations for this resource.' : 'No matching violations.'}</Box>;
  }

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

function filterViolations(violations: readonly WebViolation[], filter: string | undefined, search: string): readonly WebViolation[] {
  let result = violations;

  if (filter) {
    const filtered: WebViolation[] = [];
    for (const v of result) {
      const matchingOccs = v.occurrences.filter(
        (occ) => occ.constructPath === filter || occ.constructPath.startsWith(filter + '/'),
      );
      if (matchingOccs.length > 0) {
        filtered.push({ ...v, occurrences: matchingOccs });
      }
    }
    result = filtered;
  }

  if (search.trim()) {
    const q = search.trim().toLowerCase();
    result = result.filter((v) =>
      v.ruleName.toLowerCase().includes(q) ||
      (v.description ?? '').toLowerCase().includes(q) ||
      (v.suggestedFix ?? '').toLowerCase().includes(q) ||
      v.occurrences.some((occ) => occ.constructPath.toLowerCase().includes(q)),
    );
  }

  return result;
}


function ViolationItem({ violation, onNavigate }: { readonly violation: WebViolation; readonly onNavigate: NavigateHandler }): JSX.Element {
  const severity = displaySeverity(violation);
  const count = violation.occurrences.length;
  const title = violation.description?.trim() || violation.ruleName;
  const showRuleName = title !== violation.ruleName;
  return (
    <ExpandableSection
      variant="footer"
      headerText={
        <div style={HEADER_WRAPPER_STYLE}>
          <div style={HEADER_ROW_STYLE}>
            <span style={TITLE_GROUP_STYLE}>
              <span style={severityStyle(severity)}>[{severity.toUpperCase()}]</span>
              <span style={RULE_STYLE} title={violation.ruleName}>{title}</span>
            </span>
            {showRuleName && <code style={RULE_NAME_STYLE} title={violation.ruleName}>{violation.ruleName}</code>}
          </div>
          <div style={SUBTITLE_STYLE}>
            {count} {count === 1 ? 'construct' : 'constructs'} {'·'} {violation.source}
          </div>
        </div>
      }
    >
      <div style={BODY_STYLE}>
        {violation.suggestedFix && <Box variant="small">Suggested fix: {violation.suggestedFix}</Box>}
        {violation.occurrences.map((occ, i) => (
          <OccurrenceRow key={`${occ.constructPath}:${i}`} occurrence={occ} severity={severity} onNavigate={onNavigate} />
        ))}
      </div>
    </ExpandableSection>
  );
}

function OccurrenceRow({ occurrence, severity, onNavigate }: {
  readonly occurrence: WebViolationOccurrence;
  readonly severity: string;
  readonly onNavigate: NavigateHandler;
}): JSX.Element {
  const handleClick = React.useCallback(() => {
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
      <span style={LINK_STYLE} onClick={handleClick} title="Navigate to source">
        {occurrence.constructPath}
        {occurrence.logicalId ? ` → ${occurrence.logicalId}` : ''}
        {occurrence.templateFile ? ` (${occurrence.templateFile})` : ''}
      </span>
    </Box>
  );
}

function severityStyle(severity: string): React.CSSProperties {
  return { color: severityHexColor(severity), fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 };
}

const SCROLL_STYLE: React.CSSProperties = { flex: '1 1 0', overflowY: 'auto', overflowX: 'hidden', minHeight: 0 };
const HEADER_WRAPPER_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '2px', width: '100%', overflow: 'hidden' };
const HEADER_ROW_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: '8px', width: '100%', justifyContent: 'space-between', overflow: 'hidden' };
const TITLE_GROUP_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0, flex: '1 1 0', overflow: 'hidden' };
const RULE_STYLE: React.CSSProperties = { fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const RULE_NAME_STYLE: React.CSSProperties = { fontFamily: 'monospace', fontSize: '12px', color: '#5f6b7a', fontWeight: 400, whiteSpace: 'nowrap', flexShrink: 0 };
const SUBTITLE_STYLE: React.CSSProperties = { color: '#5f6b7a', fontWeight: 400, fontSize: '12px' };
const BODY_STYLE: React.CSSProperties = { paddingLeft: '4px', display: 'flex', flexDirection: 'column', gap: '4px' };
const LINK_STYLE: React.CSSProperties = { color: '#0972d3', textDecoration: 'underline', cursor: 'pointer' };
