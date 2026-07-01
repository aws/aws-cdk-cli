import Box from '@cloudscape-design/components/box';
import Icon from '@cloudscape-design/components/icon';
import * as React from 'react';
import { severityHexColor } from '../../lib/web/severity';
import type { WebConstructNode } from '../api';

interface ConstructTreeProps {
  readonly nodes: readonly WebConstructNode[];
  readonly depth?: number;
}

/** Auto-expand the tree through this depth on load (0 = root), so stacks and their top-level constructs are visible without manual clicks. */
const AUTO_EXPAND_DEPTH = 2;

/**
 * Renders the construct hierarchy as a nested, indented list. Rows never spill
 * past the panel: long labels truncate with an ellipsis and the tree clips
 * horizontally. Nodes collapse via a caret (whole-row click). Display-only.
 */
export function ConstructTree({ nodes, depth = 0 }: ConstructTreeProps): JSX.Element {
  if (nodes.length === 0) {
    return <Box color="text-status-inactive">No constructs.</Box>;
  }
  const list = (
    <ul style={LIST_STYLE}>
      {nodes.map((node) => (
        <TreeNode key={node.path} node={node} depth={depth} />
      ))}
    </ul>
  );
  // Root render: wrap once in the clipping viewport; nested calls return the bare list.
  return depth === 0 ? <div style={TREE_VIEWPORT_STYLE}>{list}</div> : list;
}

function TreeNode({ node, depth }: { readonly node: WebConstructNode; readonly depth: number }): JSX.Element {
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = React.useState(depth < AUTO_EXPAND_DEPTH);

  const label = friendlyName(node);
  const severity = node.highestSeverity;
  const severityColor = severity ? severityHexColor(severity) : undefined;
  const inherited = !severity ? node.inheritedSeverity : undefined;
  const inheritedColor = inherited ? severityHexColor(inherited) : undefined;

  return (
    <li style={ITEM_STYLE}>
      <div
        style={hasChildren ? ROW_CLICKABLE_STYLE : ROW_STYLE}
        onClick={hasChildren ? () => setExpanded((e) => !e) : undefined}
        role={hasChildren ? 'button' : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
      >
        {hasChildren ? <span style={CARET_STYLE}>{expanded ? '\u25be' : '\u25b8'}</span> : <span style={CARET_SPACER} />}
        <Icon name={hasChildren ? 'folder' : 'file'} variant="subtle" />
        {severityColor && (
          <span
            style={{ ...SEVERITY_DOT_STYLE, background: severityColor }}
            title={`${severity} violation on this construct`}
            aria-label={`${severity} violation`}
          />
        )}
        <span style={labelStyle(severityColor, inheritedColor)} title={node.path}>
          {label}
        </span>
        {node.type && (
          <span style={TYPE_STYLE} title={node.type}>
            {friendlyType(node.type)}
          </span>
        )}
      </div>
      {hasChildren && expanded && <ConstructTree nodes={node.children} depth={depth + 1} />}
    </li>
  );
}

/** Friendlier default label: a generic CDK id ("Resource"/"Default") shows its resource type instead. */
function friendlyName(node: WebConstructNode): string {
  if ((node.id === 'Resource' || node.id === 'Default') && node.type) {
    return friendlyType(node.type);
  }
  return node.id;
}

/** "AWS::DynamoDB::Table" -> "DynamoDB Table". */
function friendlyType(type: string): string {
  return type.replace(/^AWS::/, '').split('::').join(' ');
}

function labelStyle(severityColor: string | undefined, inheritedColor: string | undefined): React.CSSProperties {
  if (severityColor) return { ...LABEL_STYLE, color: severityColor };
  if (inheritedColor) return { ...LABEL_STYLE, color: inheritedColor, opacity: 0.7 };
  return LABEL_STYLE;
}

const TREE_VIEWPORT_STYLE: React.CSSProperties = { overflowX: 'hidden', overflowY: 'auto', height: '100%' };
const SEVERITY_DOT_STYLE: React.CSSProperties = {
  flexShrink: 0,
  width: '8px',
  height: '8px',
  borderRadius: '50%',
};
const LIST_STYLE: React.CSSProperties = { listStyle: 'none', margin: 0, paddingLeft: '12px', borderLeft: '1px solid #e9ebed' };
const ITEM_STYLE: React.CSSProperties = { padding: '2px 0' };
const ROW_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, overflow: 'hidden' };
const ROW_CLICKABLE_STYLE: React.CSSProperties = { ...ROW_STYLE, cursor: 'pointer' };
const LABEL_STYLE: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontWeight: 500,
};
const TYPE_STYLE: React.CSSProperties = {
  flex: '0 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  paddingLeft: '8px',
  color: '#5f6b7a',
  fontSize: '12px',
};
const CARET_STYLE: React.CSSProperties = {
  width: '12px',
  flexShrink: 0,
  fontSize: '10px',
  lineHeight: 1,
};
const CARET_SPACER: React.CSSProperties = { display: 'inline-block', width: '12px', flexShrink: 0 };
