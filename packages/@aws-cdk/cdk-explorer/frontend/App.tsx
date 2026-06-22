import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import Spinner from '@cloudscape-design/components/spinner';
import * as React from 'react';
import { api, type TreeResponse, type ViolationsResponse } from './api';
import { ConstructTree } from './components/ConstructTree';
import { FilePane } from './components/FilePane';
import { ViolationsPanel } from './components/ViolationsPanel';

/** Web explorer shell. Two splits: horizontal between the construct tree and the file panes, vertical between the top row and the violations panel. Each split has a draggable resizer with an arrow toggle that collapses one side. */
export function App(): JSX.Element {
  const [tree, setTree] = React.useState<TreeResponse | undefined>();
  const [violations, setViolations] = React.useState<ViolationsResponse | undefined>();
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => {
    Promise.all([api.getTree(), api.getViolations()])
      .then(([t, v]) => {
        setTree(t);
        setViolations(v);
        setError(undefined);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Vertical split: violations row's share of the page height (default 33%).
  const vSplit = useSplit({ orientation: 'vertical', defaultFraction: 0.33, min: 0.15, max: 0.85 });
  // Horizontal split inside the top row: file panes' share of that row's width (default 75%; tree gets the remaining 25%).
  const hSplit = useSplit({ orientation: 'horizontal', defaultFraction: 0.75, min: 0.4, max: 0.85 });

  return (
    <div style={PAGE_STYLE} ref={vSplit.containerRef}>
      <header style={TITLE_BLOCK_STYLE}>
        <Header variant="h1" description="last updated: —">CDK Web Explorer</Header>
      </header>
      {error && <Box color="text-status-error">{error}</Box>}
      <div style={topRowStyle(vSplit)} ref={hSplit.containerRef}>
        <div style={treePaneStyle(hSplit)}>
          {!hSplit.collapsed && (
            <div style={GROW_STYLE}>
              <Container fitHeight header={<Header variant="h2">Construct Tree</Header>}>
                <ConstructTreeContent tree={tree} />
              </Container>
            </div>
          )}
        </div>
        <Resizer split={hSplit} />
        <div style={filesPaneStyle(hSplit)}>
          <Grid gridDefinition={[{ colspan: 6 }, { colspan: 6 }]}>
            <FilePane title="file 1" />
            <FilePane title="file 2" />
          </Grid>
        </div>
      </div>
      <div style={bottomRowStyle(vSplit)}>
        <Resizer split={vSplit} />
        {!vSplit.collapsed && (
          <div style={GROW_STYLE}>
            <Container fitHeight header={<Header variant="h2">Violations</Header>}>
              <ViolationsContent violations={violations} />
            </Container>
          </div>
        )}
      </div>
    </div>
  );
}

function ConstructTreeContent({ tree }: { readonly tree?: TreeResponse }): JSX.Element {
  if (!tree) return <Spinner />;
  if (tree.status === 'not-synthesized') {
    return <Box color="text-status-inactive">No cloud assembly found. Run cdk synth first.</Box>;
  }
  return <ConstructTree nodes={tree.tree} />;
}

function ViolationsContent({ violations }: { readonly violations?: ViolationsResponse }): JSX.Element {
  if (!violations) return <Spinner />;
  if (violations.status === 'not-synthesized') {
    return <Box color="text-status-inactive">No cloud assembly found.</Box>;
  }
  return <ViolationsPanel violations={violations.violations} />;
}

interface SplitOptions {
  /** 'horizontal' = the resizer moves left/right (separating columns). 'vertical' = the resizer moves up/down (separating rows). */
  readonly orientation: 'horizontal' | 'vertical';
  readonly defaultFraction: number;
  readonly min: number;
  readonly max: number;
}

interface Split extends SplitOptions {
  /** Fraction the *trailing* pane (right column / bottom row) takes of its container; 0..1. */
  readonly fraction: number;
  readonly collapsed: boolean;
  readonly toggleCollapsed: () => void;
  readonly startDrag: (e: React.MouseEvent) => void;
  readonly containerRef: React.RefObject<HTMLDivElement>;
}

/** Drives a resizable / collapsible split. Drag updates the fraction live; the arrow toggles full collapse of the trailing pane. */
function useSplit(opts: SplitOptions): Split {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [fraction, setFraction] = React.useState(opts.defaultFraction);
  const [collapsed, setCollapsed] = React.useState(false);

  const startDrag = React.useCallback((e: React.MouseEvent) => {
    if (collapsed) return; // Drag while collapsed makes no sense; user must expand first via the arrow.
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = opts.orientation === 'vertical' ? 'row-resize' : 'col-resize';
    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      // Trailing pane share grows as the pointer moves toward the leading edge.
      const frac = opts.orientation === 'vertical'
        ? (rect.bottom - ev.clientY) / rect.height
        : (rect.right - ev.clientX) / rect.width;
      setFraction(Math.min(opts.max, Math.max(opts.min, frac)));
    };
    const onUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [collapsed, opts.orientation, opts.min, opts.max]);

  const toggleCollapsed = React.useCallback(() => setCollapsed((c) => !c), []);

  return { ...opts, fraction, collapsed, toggleCollapsed, startDrag, containerRef };
}

/** Thin strip pinned to the edge of the trailing pane. The whole strip is the drag handle; a centered arrow toggles collapse. */
function Resizer({ split }: { readonly split: Split }): JSX.Element {
  const isVertical = split.orientation === 'vertical';
  // Arrow points the way the boundary travels on collapse, and flips once collapsed.
  const arrow = isVertical
    ? (split.collapsed ? '▲' : '▼')
    : (split.collapsed ? '▶' : '◀');
  const verb = isVertical
    ? (split.collapsed ? 'Expand violations' : 'Collapse violations')
    : (split.collapsed ? 'Expand construct tree' : 'Collapse construct tree');
  return (
    <div
      style={resizerStyle(split)}
      role="separator"
      aria-orientation={isVertical ? 'horizontal' : 'vertical'}
      onMouseDown={split.startDrag}
    >
      <button
        type="button"
        style={isVertical ? RESIZER_BUTTON_HORIZONTAL : RESIZER_BUTTON_VERTICAL}
        title={verb}
        aria-label={verb}
        aria-expanded={!split.collapsed}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={split.toggleCollapsed}
      >
        {arrow}
      </button>
    </div>
  );
}

function topRowStyle(vSplit: Split): React.CSSProperties {
  return {
    display: 'flex',
    minHeight: 0,
    alignItems: 'stretch',
    flexDirection: 'row',
    flex: vSplit.collapsed ? '1 1 auto' : `${1 - vSplit.fraction} 1 0`,
  };
}

function bottomRowStyle(vSplit: Split): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    flex: vSplit.collapsed ? '0 0 auto' : `${vSplit.fraction} 1 0`,
  };
}

function treePaneStyle(hSplit: Split): React.CSSProperties {
  return {
    flex: hSplit.collapsed ? '0 0 0' : `0 0 ${(1 - hSplit.fraction) * 100}%`,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
  };
}

function filesPaneStyle(hSplit: Split): React.CSSProperties {
  return {
    flex: hSplit.collapsed ? '1 1 auto' : `0 0 ${hSplit.fraction * 100}%`,
    minWidth: 0,
    minHeight: 0,
  };
}

function resizerStyle(split: Split): React.CSSProperties {
  if (split.orientation === 'vertical') {
    return {
      flexShrink: 0,
      height: split.collapsed ? '20px' : '10px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: split.collapsed ? 'pointer' : 'row-resize',
      position: 'relative',
      marginBottom: split.collapsed ? 0 : '-4px',
    };
  }
  return {
    flexShrink: 0,
    width: split.collapsed ? '20px' : '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: split.collapsed ? 'pointer' : 'col-resize',
    position: 'relative',
    // Slide 4px left so the pill straddles the tree pane's border.
    marginLeft: split.collapsed ? 0 : '-4px',
  };
}

const PAGE_STYLE: React.CSSProperties = {
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  padding: '16px',
  boxSizing: 'border-box',
  overflow: 'hidden',
};
const TITLE_BLOCK_STYLE: React.CSSProperties = { flexShrink: 0, marginBottom: '12px' };
/** Wraps a Cloudscape Container so it stretches to fill its flex parent (Container is intrinsically sized). */
const GROW_STYLE: React.CSSProperties = { flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%' };

const RESIZER_BUTTON_BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid #d1d5db',
  background: '#ffffff',
  color: '#5f6b7a',
  fontSize: '10px',
  lineHeight: 1,
  cursor: 'pointer',
  zIndex: 1,
  padding: 0,
};
const RESIZER_BUTTON_HORIZONTAL: React.CSSProperties = {
  ...RESIZER_BUTTON_BASE,
  width: '40px',
  height: '14px',
  borderRadius: '7px',
};
const RESIZER_BUTTON_VERTICAL: React.CSSProperties = {
  ...RESIZER_BUTTON_BASE,
  width: '14px',
  height: '40px',
  borderRadius: '7px',
};
