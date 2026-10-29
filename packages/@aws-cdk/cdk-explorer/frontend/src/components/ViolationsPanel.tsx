import Box from '@cloudscape-design/components/box';
import Link from '@cloudscape-design/components/link';
import List from '@cloudscape-design/components/list';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import TextFilter from '@cloudscape-design/components/text-filter';
import Token from '@cloudscape-design/components/token';
import * as React from 'react';
import { Flex } from './Flex';
import { colorForSeverity, iconForSeverity } from './severities';
import type { ViolationsResponse, WebViolation } from '../../../lib/web-shared/protocol';
import { displaySeverity, severityRank } from '../../../lib/web-shared/severity';
import type { NavigateHandler } from '../nav-types';

interface ViolationsPanelProps {
  readonly violations: readonly WebViolation[];
  readonly onNavigate: NavigateHandler;
}

export function ViolationsList({ violations, onNavigate }: ViolationsPanelProps): JSX.Element {
  if (violations.length === 0) {
    return <StatusIndicator type="success">No diagnostics found.</StatusIndicator>;
  }

  const sorted = [...violations].sort((a, b) => severityRank(displaySeverity(a)) - severityRank(displaySeverity(b)));

  if (sorted.length === 0) {
    return <Box color="text-status-inactive">No matching diagnostics.</Box>;
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
          id: `${viol.source}:${viol.ruleName}:${viol.occurrences.map(occ => occ.constructPath).join(',')}`,
          icon: iconForSeverity(viol.severity, viol.customSeverity),
          content:
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: '8px' }}>
              <div style={{ flexGrow: 0, flexShrink: 0, color: colorForSeverity(viol.severity), fontWeight: 'bold', marginRight: '1em', width: '6em' }}>[{displaySev.toUpperCase()}]</div>
              <div style={{ flexGrow: 1 }}>
                <div style={{ float: 'right', marginLeft: '1em' }}>
                  {showRuleName && <code style={RULE_NAME_STYLE} title={viol.ruleName}>{viol.ruleName}</code>}
                </div>
                <details>
                  <summary style={{ cursor: 'pointer' }}>
                    {title}<br/>
                    <Box variant="small">
                      {count} {count === 1 ? 'construct' : 'constructs'} {'·'} {viol.source}
                    </Box>
                  </summary>
                  {viol.suggestedFix && <Box variant="small">Suggested fix: {viol.suggestedFix}</Box>}
                  {viol.occurrences.map((occ, i) => (
                    <div key={i} style={{ fontSize: 'small' }}>
                      <Link fontSize="body-s" variant="primary" onFollow={() => onNavigate({
                        trigger: 'diagnostic',
                        constructPath: occ.constructPath,
                        sourceLocation: occ.sourceLocations?.[0],
                        templateLocation: occ.logicalId && occ.templateFile ? {
                          logicalId: occ.logicalId,
                          file: occ.templateFile,
                        } : undefined,
                      })}>
                        {occ.constructPath}
                      </Link>
                    </div>
                  ))}
                </details>
              </div>
            </div>,
        };
      }}
    >
    </List>
  );
}

const RULE_NAME_STYLE: React.CSSProperties = { fontFamily: 'monospace', fontSize: '12px', color: '#5f6b7a', fontWeight: 400, whiteSpace: 'nowrap', flexShrink: 0 };

export function ViolationsPanelContent({ violations, onNavigate, status }: {
  readonly status?: ViolationsResponse['status'];
  readonly violations: readonly WebViolation[];
  readonly onNavigate: NavigateHandler;
}): JSX.Element {
  if (!status) return <Spinner />;
  if (status === 'not-synthesized') {
    return <Box color="text-status-inactive">No cloud assembly found.</Box>;
  }
  return <ViolationsList
    violations={violations}
    onNavigate={onNavigate}
  />;
}

export function ViolationsConstructFilter(
  { constructPathFilter, onClearFilter }:
  { readonly constructPathFilter?: string; readonly onClearFilter: () => void },
): JSX.Element {
  if (!constructPathFilter) return <></>;
  const name = constructPathFilter.split('/').pop() || constructPathFilter;
  return (
    <Flex>
      <>Limited to</>
      <Token
        onDismiss={onClearFilter}
        dismissLabel="Show all diagnostics"
        label={name}
        style={{ root: { paddingInline: '8px' } }}
      />
    </Flex>
  );
}

export function ViolationsSearch({ search, onSearchChange }: {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
}): JSX.Element {
  return (
    <TextFilter
      filteringText={search}
      filteringPlaceholder="Filter diagnostics"
      filteringAriaLabel="Filter diagnostics"
      onChange={({ detail }) =>
        onSearchChange(detail.filteringText)
      }
    />
  );
}

export function filterViolations(violations: readonly WebViolation[], constructPathFilter?: string, search?: string): readonly WebViolation[] {
  let result = violations;

  if (constructPathFilter) {
    result = violations
      .map((v) => ({
        ...v,
        occurrences: v.occurrences.filter(
          (occ) => occ.constructPath === constructPathFilter || occ.constructPath.startsWith(constructPathFilter + '/'),
        ),
      }))
      .filter((v) => v.occurrences.length > 0);
  }

  const q = search.trim().toLowerCase();
  if (q) {
    result = result.filter((v) =>
      v.ruleName.toLowerCase().includes(q) ||
      (v.description ?? '').toLowerCase().includes(q) ||
      (v.suggestedFix ?? '').toLowerCase().includes(q) ||
      v.occurrences.some((occ) => occ.constructPath.toLowerCase().includes(q)),
    );
  }

  return result;
}

export function diagnosticsPanelTitle(response: ViolationsResponse | undefined, violations: readonly WebViolation[]) {
  if (response?.status !== 'ok') {
    return 'Diagnostics';
  }

  if (violations.length !== response.violations.length) {
    return `Diagnostics (${violations.length} out of ${response.violations.length})`;
  } else {
    return `Diagnostics (${response.violations.length})`;
  }
}
