import Box from '@cloudscape-design/components/box';
import Icon from '@cloudscape-design/components/icon';
import * as React from 'react';
import type { WebConstructNode } from '../api';

interface ConstructTreeProps {
  readonly nodes: readonly WebConstructNode[];
}

/**
 * Renders the construct hierarchy as a nested, indented list. Rows never spill
 * past the panel: long labels truncate with an ellipsis and the tree clips
 * horizontally. Nodes collapse via a caret (whole-row click). A node can be
 * renamed by double-clicking its label; the override is persisted to
 * localStorage and a revert control restores the default. Display-only.
 */
export function ConstructTree({ nodes }: ConstructTreeProps): JSX.Element {
  const names = React.useContext(TreeNamesContext);
  if (nodes.length === 0) {
    return <Box color="text-status-inactive">No constructs.</Box>;
  }
  const list = (
    <ul style={LIST_STYLE}>
      {nodes.map((node) => (
        <TreeNode key={node.path} node={node} />
      ))}
    </ul>
  );
  // Root render (no surrounding provider): own the rename store + the clip box.
  if (!names) {
    return (
      <TreeNamesProvider>
        <div style={TREE_VIEWPORT_STYLE}>{list}</div>
      </TreeNamesProvider>
    );
  }
  return list;
}

function TreeNode({ node }: { readonly node: WebConstructNode }): JSX.Element {
  const names = React.useContext(TreeNamesContext)!;
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  const override = names.overrides[node.path];
  const defaultLabel = friendlyName(node);
  const label = override ?? defaultLabel;

  const commit = (raw: string): void => {
    const value = raw.trim();
    if (value && value !== defaultLabel) {
      names.rename(node.path, value);
    } else {
      names.reset(node.path);
    }
    setEditing(false);
  };

  return (
    <li style={ITEM_STYLE}>
      <div
        style={hasChildren ? ROW_CLICKABLE_STYLE : ROW_STYLE}
        onClick={hasChildren && !editing ? () => setExpanded((e) => !e) : undefined}
        role={hasChildren ? 'button' : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
      >
        {hasChildren ? <span style={CARET_STYLE}>{expanded ? '\u25be' : '\u25b8'}</span> : <span style={CARET_SPACER} />}
        <Icon name={hasChildren ? 'folder' : 'file'} variant="subtle" />
        {editing ? (
          <input
            autoFocus
            defaultValue={label}
            style={EDIT_INPUT_STYLE}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(e.currentTarget.value);
              else if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={(e) => commit(e.currentTarget.value)}
          />
        ) : (
          <span
            style={LABEL_STYLE}
            title={`${node.path} (double-click to rename)`}
            onDoubleClick={() => setEditing(true)}
          >
            {label}
          </span>
        )}
        {node.type && !editing && (
          <span style={TYPE_STYLE} title={node.type}>
            {friendlyType(node.type)}
          </span>
        )}
        {override !== undefined && !editing && (
          <button
            type="button"
            style={REVERT_BUTTON_STYLE}
            title="Revert to default name"
            aria-label="Revert to default name"
            onClick={(e) => {
              e.stopPropagation();
              names.reset(node.path);
            }}
          >
            {'\u21ba'}
          </button>
        )}
      </div>
      {hasChildren && expanded && <ConstructTree nodes={node.children} />}
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

interface TreeNames {
  readonly overrides: Readonly<Record<string, string>>;
  readonly rename: (path: string, name: string) => void;
  readonly reset: (path: string) => void;
}

const TreeNamesContext = React.createContext<TreeNames | null>(null);
const NAME_OVERRIDES_KEY = 'cdk-explorer:tree-name-overrides';

/** Holds user rename overrides (keyed by construct path) and persists them to localStorage. */
function TreeNamesProvider({ children }: { readonly children: React.ReactNode }): JSX.Element {
  const [overrides, setOverrides] = React.useState<Record<string, string>>(loadOverrides);
  React.useEffect(() => {
    window.localStorage.setItem(NAME_OVERRIDES_KEY, JSON.stringify(overrides));
  }, [overrides]);
  const api = React.useMemo<TreeNames>(
    () => ({
      overrides,
      rename: (path, name) => setOverrides((o) => ({ ...o, [path]: name })),
      reset: (path) =>
        setOverrides((o) => {
          if (!(path in o)) return o;
          const next = { ...o };
          delete next[path];
          return next;
        }),
    }),
    [overrides],
  );
  return <TreeNamesContext.Provider value={api}>{children}</TreeNamesContext.Provider>;
}

/** Read persisted overrides; tolerate absent or corrupt storage by starting empty. */
function loadOverrides(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(NAME_OVERRIDES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const TREE_VIEWPORT_STYLE: React.CSSProperties = { overflowX: 'hidden', overflowY: 'auto', maxHeight: '60vh' };
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
const EDIT_INPUT_STYLE: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  font: 'inherit',
  padding: '0 2px',
  border: '1px solid #9ba7b4',
  borderRadius: '2px',
};
const REVERT_BUTTON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  marginLeft: '6px',
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: '#5f6b7a',
  fontSize: '12px',
  lineHeight: 1,
};
const CARET_STYLE: React.CSSProperties = {
  width: '12px',
  flexShrink: 0,
  fontSize: '10px',
  lineHeight: 1,
};
const CARET_SPACER: React.CSSProperties = { display: 'inline-block', width: '12px', flexShrink: 0 };
