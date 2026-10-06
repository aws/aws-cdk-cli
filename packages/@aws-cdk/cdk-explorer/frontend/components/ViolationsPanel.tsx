import Box from '@cloudscape-design/components/box';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import * as React from 'react';
import { displaySeverity, severityHexColor, severityRank } from '../../lib/web/severity';
import type { WebViolation, WebViolationOccurrence } from '../api';
import type { NavigateHandler } from '../nav-types';
import { Link, List } from '@cloudscape-design/components';
import { colorForSeverity, iconForSeverity } from './severities';

interface ViolationsPanelProps {
  readonly violations: readonly WebViolation[];
  readonly onNavigate: NavigateHandler;
  readonly filter?: string;
  readonly onClearFilter: () => void;
  readonly search: string;
}

export function ViolationsPanel({ violations, onNavigate, filter, search }: ViolationsPanelProps): JSX.Element {
  if (violations.length === 0) {
    return <StatusIndicator type="success">No diagnostics found.</StatusIndicator>;
  }

  const filtered = filterViolations(violations, filter, search);
  const sorted = [...filtered].sort((a, b) => severityRank(displaySeverity(a)) - severityRank(displaySeverity(b)));

  if (sorted.length === 0) {
    return <Box color="text-status-inactive">{filter ? 'No diagnostics for this resource.' : 'No matching diagnostics.'}</Box>;
  }

  return (
    <List
      ariaLabel='List of diagnostics'
      items={violations}
      renderItem={(viol) => {
        const displaySev = displaySeverity(viol);
        const title = viol.description?.trim() ?? viol.ruleName;
        const showRuleName = title !== viol.ruleName;
        const count = viol.occurrences.length;

        return {
          id: `${viol.source}:${viol.ruleName}`,
          icon: iconForSeverity(viol.severity, viol.customSeverity),
          content:
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: '8px' }}>
              <div style={{ flexGrow: 0, flexShrink: 0, color: colorForSeverity(viol.severity), fontWeight: 'bold', marginRight: '1em' }}>[{displaySev.toUpperCase()}]</div>
              <div style={{ flexGrow: 1 }}>
                <details>
                  <summary style={{ cursor: 'pointer' }}>
                    {title}
                    <Box variant="small">
                      {count} {count === 1 ? 'construct' : 'constructs'} {'·'} {viol.source}
                    </Box>
                  </summary>
                  {viol.suggestedFix && <Box variant="small">Suggested fix: {viol.suggestedFix}</Box>}
                  {viol.occurrences.map((occ, i) => (
                      <Link variant="primary" onFollow={() => onNavigate({
                        ...occ,
                      })}>
                        {occ.constructPath}
                        {occ.logicalId ? ` → ${occ.logicalId}` : ''}
                        {occ.templateFile ? ` (${occ.templateFile})` : ''}
                      </Link>
                  ))}
                </details>
              </div>
              <div style={{ flexGrow: 0 }}>
                {showRuleName && <code style={RULE_NAME_STYLE} title={viol.ruleName}>{viol.ruleName}</code>}
              </div>
            </div>
        };
      }}
      >
    </List>
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

const RULE_NAME_STYLE: React.CSSProperties = { fontFamily: 'monospace', fontSize: '12px', color: '#5f6b7a', fontWeight: 400, whiteSpace: 'nowrap', flexShrink: 0 };
