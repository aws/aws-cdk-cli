import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import * as React from 'react';
import { buildSourceAnchorIndex, findConstructAtLine } from '../lib/web/source-nav';
import { api, type TemplateResponse, type TreeResponse, type ViolationsResponse } from './api';
import { CodeViewer, type Diagnostic } from './components/CodeViewer';
import { ConstructTree } from './components/ConstructTree';
import type { Language } from './syntax';
import { TemplateViewer, type Format } from './components/TemplateViewer';
import { ViolationsPanel } from './components/ViolationsPanel';
import type { NavigateHandler } from './nav-types';
export type { NavigateHandler } from './nav-types';

/** Navigation target describing what both panes should show. */
export interface NavTarget {
  readonly source?: { file: string; startLine: number; endLine: number };
  readonly template?: { file: string; logicalId: string };
  readonly color: string;
  readonly navCounter: number;
}

const NEUTRAL_COLOR = '#5f6b7a';

/** Web explorer shell. */
export function App(): JSX.Element {
  const [tree, setTree] = React.useState<TreeResponse | undefined>();
  const [violations, setViolations] = React.useState<ViolationsResponse | undefined>();
  const [error, setError] = React.useState<string | undefined>();
  const [appDir, setAppDir] = React.useState<string | undefined>();

  // Source pane state.
  const [sourceFile, setSourceFile] = React.useState<string | undefined>();
  const [sourceContent, setSourceContent] = React.useState('');
  // True when the open source file was edited after the current assembly's synth
  // started, so its squiggles/nav anchors may be stale. Set from /api/file.
  const [sourceStale, setSourceStale] = React.useState(false);

  // Template pane state.
  const [templateFile, setTemplateFile] = React.useState<string | undefined>();
  const [templateData, setTemplateData] = React.useState<TemplateResponse | undefined>();
  const [templateFormat, setTemplateFormat] = React.useState<Format>('yaml');

  // Refs for current values in async callbacks (avoids stale closures).
  const sourceFileRef = React.useRef(sourceFile);
  sourceFileRef.current = sourceFile;
  const templateFileRef = React.useRef(templateFile);
  templateFileRef.current = templateFile;
  const templateDataRef = React.useRef(templateData);
  templateDataRef.current = templateData;

  // Navigation state shared across panes.
  const [nav, setNav] = React.useState<NavTarget | undefined>();
  const navCounterRef = React.useRef(0);

  // Violations filter: when set, only violations affecting this construct path are shown.
  const [violationFilter, setViolationFilter] = React.useState<string | undefined>();
  const [violationSearch, setViolationSearch] = React.useState('');

  const reload = React.useCallback((): void => {
    Promise.all([api.getTree(), api.getViolations(), api.getAppInfo()])
      .then(([t, v, info]) => {
        setTree(t);
        setViolations(v);
        setAppDir(info.appDir);
        setError(undefined);
      })
      // Keep the last good render on a transient read (e.g. a mid-synth write);
      // the next assembly-changed event re-fetches once the write has settled.
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Re-read the currently open source file, refreshing both its content and its
  // staleness flag. Used after a synth (assembly changed) to clear a banner, and
  // on a source edit to raise one, without the user re-opening the file.
  const refreshOpenSourceFile = React.useCallback(async (): Promise<void> => {
    const file = sourceFileRef.current;
    if (!file) return;
    try {
      const res = await api.readFile(file);
      setSourceContent(res.content);
      setSourceStale(res.stale);
    } catch {
      // Keep the last good content; a later event re-tries.
    }
  }, []);

  React.useEffect(() => {
    reload();
    return api.subscribe({
      onAssemblyChanged: () => {
        reload();
        void refreshOpenSourceFile();
      },
      onSourceChanged: () => {
        void refreshOpenSourceFile();
      },
    });
  }, [reload, refreshOpenSourceFile]);

  /** Navigate to a construct (from tree double-click or violation double-click). */
  const navigate: NavigateHandler = React.useCallback(async (opts) => {
    const counter = ++navCounterRef.current;
    const color = opts.color ?? NEUTRAL_COLOR;

    if (opts.constructPath) {
      setViolationFilter(opts.constructPath);
    }

    let sourceTarget: NavTarget['source'];
    if (opts.sourceLocation) {
      sourceTarget = { file: opts.sourceLocation.file, startLine: opts.sourceLocation.line, endLine: opts.sourceLocation.line };
      if (sourceFileRef.current !== opts.sourceLocation.file) {
        try {
          const res = await api.readFile(opts.sourceLocation.file);
          setSourceFile(res.path);
          setSourceContent(res.content);
          setSourceStale(res.stale);
        } catch {
          setSourceFile(opts.sourceLocation.file);
          setSourceContent(`// Could not load ${opts.sourceLocation.file}`);
          setSourceStale(false);
        }
      }
    }

    let templateTarget: NavTarget['template'];
    if (opts.templateFile && opts.logicalId) {
      if (templateFileRef.current !== opts.templateFile) {
        try {
          const data = await api.getTemplate(opts.templateFile);
          setTemplateFile(opts.templateFile);
          setTemplateData(data);
        } catch {
          setTemplateFile(opts.templateFile);
          setTemplateData(undefined);
        }
      }
      // Carry identity only; TemplateViewer resolves the highlight line from the
      // rendered format (JSON or YAML), which is the sole coordinate authority.
      templateTarget = { file: opts.templateFile, logicalId: opts.logicalId };
    }

    setNav({ source: sourceTarget, template: templateTarget, color, navCounter: counter });
  }, []);

  /** Jump from template pane to source (the "Open in source" button). */
  const jumpToSource = React.useCallback(async (logicalId: string) => {
    const data = templateDataRef.current;
    if (!data) return;
    const resource = data.resources[logicalId];
    if (!resource?.source) return;
    const counter = ++navCounterRef.current;
    if (sourceFileRef.current !== resource.source.file) {
      try {
        const res = await api.readFile(resource.source.file);
        setSourceFile(res.path);
        setSourceContent(res.content);
        setSourceStale(res.stale);
      } catch { return; }
    }
    setNav({
      source: { file: resource.source.file, startLine: resource.source.line, endLine: resource.source.line },
      template: undefined,
      color: NEUTRAL_COLOR,
      navCounter: counter,
    });
  }, []);

  // Per-file index of constructs navigable from source to template, built from
  // the construct tree the app already loads. Rebuilt only when the tree changes.
  const sourceAnchors = React.useMemo(
    () => (tree?.status === 'ok' ? buildSourceAnchorIndex(tree.tree) : undefined),
    [tree],
  );

  /** Double-click a line in the source pane to jump to its resource in the template. */
  const handleSourceDoubleClick = React.useCallback((line: number) => {
    const file = sourceFileRef.current;
    if (!file) return;
    const node = findConstructAtLine(sourceAnchors?.get(file), line);
    if (!node) return;
    void navigate({
      sourceLocation: node.sourceLocation,
      templateFile: node.templateFile,
      logicalId: node.logicalId,
      constructPath: node.path,
    });
  }, [sourceAnchors, navigate]);

  // File picker state.
  const [showFilePicker, setShowFilePicker] = React.useState<false | 'source' | 'template'>(false);
  const pickerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!showFilePicker) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (pickerRef.current && !pickerRef.current.contains(target)) {
        if ((target as HTMLElement).closest?.('[aria-label="Open file"], [aria-label="Open template file"]')) return;
        setShowFilePicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showFilePicker]);

  const knownSourceFiles = React.useMemo(
    () => sourceAnchors ? [...sourceAnchors.keys()].sort() : [],
    [sourceAnchors],
  );

  const knownTemplateFiles = React.useMemo(() => {
    if (!tree || tree.status !== 'ok') return [];
    const files = new Set<string>();
    const walk = (nodes: readonly import('./api').WebConstructNode[]) => {
      for (const n of nodes) {
        if (n.templateFile) files.add(n.templateFile);
        walk(n.children);
      }
    };
    walk(tree.tree);
    return [...files].sort();
  }, [tree]);

  const pickFile = React.useCallback(async (filePath: string, pane: 'source' | 'template') => {
    try {
      if (pane === 'source') {
        const res = await api.readFile(filePath);
        setSourceFile(res.path);
        setSourceContent(res.content);
        setSourceStale(res.stale);
      } else {
        const data = await api.getTemplate(filePath);
        setTemplateFile(filePath);
        setTemplateData(data);
      }
      setShowFilePicker(false);
    } catch { /* ignore */ }
  }, []);

  // Vertical split: violations row's share of the page height (default 33%).
  const vSplit = useSplit({ orientation: 'vertical', defaultFraction: 0.33, min: 0.15, max: 0.85 });
  // Horizontal split inside the top row: file panes' share of that row's width (default 75%; tree gets the remaining 25%).
  const hSplit = useSplit({ orientation: 'horizontal', defaultFraction: 0.75, min: 0.4, max: 0.85 });

  return (
    <div style={PAGE_STYLE} ref={vSplit.containerRef}>
      <header style={TITLE_BLOCK_STYLE}>
        <Header variant="h1" description={appDir ?? '—'}>CDK Web Explorer</Header>
      </header>
      {error && <Box color="text-status-error">{error}</Box>}
      <div style={topRowStyle(vSplit)} ref={hSplit.containerRef}>
        <div style={treePaneStyle(hSplit)}>
          {!hSplit.collapsed && (
            <div style={GROW_STYLE}>
              <Container fitHeight header={<Header variant="h2">Construct Tree</Header>}>
                <ConstructTreeContent tree={tree} onNavigate={navigate} />
              </Container>
            </div>
          )}
        </div>
        <Resizer split={hSplit} />
        <div style={filesPaneStyle(hSplit)}>
          <div style={CODE_PANES_STYLE}>
            <div style={CODE_PANE_STYLE}>
              <Container fitHeight header={
                <Header variant="h2">
                  <span style={PICKER_ANCHOR_STYLE}>
                    <span style={HEADER_WITH_ACTION_STYLE}>
                      {sourceFile ?? 'Source'}
                      <button type="button" style={FOLDER_BUTTON_STYLE} title={showFilePicker === 'source' ? 'Close picker' : 'Open file'} aria-label="Open file" onClick={() => showFilePicker === 'source' ? setShowFilePicker(false) : setShowFilePicker('source')}>
                        <FolderIcon />
                      </button>
                    </span>
                    {showFilePicker === 'source' && (
                      <div ref={pickerRef} style={PICKER_DROPDOWN_STYLE}>
                        <KnownFileList files={knownSourceFiles} onPick={(p) => void pickFile(p, 'source')} />
                      </div>
                    )}
                  </span>
                </Header>
              }>
                <div style={CODE_PANE_INNER_STYLE}>
                  {sourceContent ? (
                    <div style={SOURCE_PANE_COLUMN_STYLE}>
                      {sourceStale && (
                        <Alert type="warning">
                          This file has been modified since the last synth, so its violations and diagnostics may be stale. Re-run <code>cdk synth</code> to refresh.
                        </Alert>
                      )}
                      <div style={GROW_STYLE}>
                        <CodeViewer
                          content={sourceContent}
                          language={detectLanguage(sourceFile)}
                          highlightStart={nav?.source?.startLine}
                          highlightEnd={nav?.source?.endLine}
                          highlightColor={nav?.color}
                          navCounter={nav?.navCounter}
                          scrollToLine={nav?.source?.startLine}
                          onLineDoubleClick={handleSourceDoubleClick}
                          diagnostics={buildDiagnostics(sourceFile, violations)}
                        />
                      </div>
                    </div>
                  ) : (
                    <Box color="text-status-inactive">Double-click a construct to view its source.</Box>
                  )}
                </div>
              </Container>
            </div>
            <div style={CODE_PANE_STYLE}>
              <Container fitHeight header={
                <Header variant="h2" actions={templateData && <FormatToggle format={templateFormat} onChange={setTemplateFormat} />}>
                  <span style={PICKER_ANCHOR_STYLE}>
                    <span style={HEADER_WITH_ACTION_STYLE}>
                      {templateFile ?? 'Template'}
                      <button type="button" style={FOLDER_BUTTON_STYLE} title={showFilePicker === 'template' ? 'Close picker' : 'Open file'} aria-label="Open template file" onClick={() => showFilePicker === 'template' ? setShowFilePicker(false) : setShowFilePicker('template')}>
                        <FolderIcon />
                      </button>
                    </span>
                    {showFilePicker === 'template' && (
                      <div ref={pickerRef} style={PICKER_DROPDOWN_STYLE}>
                        <KnownFileList files={knownTemplateFiles} onPick={(p) => void pickFile(p, 'template')} />
                      </div>
                    )}
                  </span>
                </Header>
              }>
                <div style={CODE_PANE_INNER_STYLE}>
                  {templateData ? (
                    <TemplateViewer
                      jsonContent={templateData.content}
                      resources={templateData.resources}
                      highlightLogicalId={nav?.template?.logicalId}
                      highlightColor={nav?.color}
                      navCounter={nav?.navCounter}
                      onResourceDoubleClick={jumpToSource}
                      templateFile={templateFile}
                      violations={violations?.status === 'ok' ? violations.violations : undefined}
                      format={templateFormat}
                    />
                  ) : templateFile ? (
                    <Box color="text-status-error">Could not load {templateFile}</Box>
                  ) : (
                    <Box color="text-status-inactive">Double-click a construct to view its template.</Box>
                  )}
                </div>
              </Container>
            </div>
          </div>
        </div>
      </div>
      <div style={bottomRowStyle(vSplit)}>
        <Resizer split={vSplit} />
        {!vSplit.collapsed && (
          <div style={GROW_STYLE}>
            <Container fitHeight header={
              <Header variant="h2" actions={<ViolationsActions search={violationSearch} onSearchChange={setViolationSearch} />}>
                <ViolationsTitle filter={violationFilter} onClearFilter={() => setViolationFilter(undefined)} />
              </Header>
            }>
              <ViolationsContent violations={violations} onNavigate={navigate} filter={violationFilter} onClearFilter={() => setViolationFilter(undefined)} search={violationSearch} />
            </Container>
          </div>
        )}
      </div>
    </div>
  );
}


function KnownFileList({ files, onPick }: {
  readonly files: readonly string[];
  readonly onPick: (path: string) => void;
}): JSX.Element {
  if (files.length === 0) return <Box color="text-status-inactive">No files found.</Box>;
  return (
    <SpaceBetween size="xxs">
      {files.map((file) => (
        <Button key={file} variant="inline-link" iconName="file" onClick={() => onPick(file)}>
          {file}
        </Button>
      ))}
    </SpaceBetween>
  );
}

function ConstructTreeContent({ tree, onNavigate }: { readonly tree?: TreeResponse; readonly onNavigate: NavigateHandler }): JSX.Element {
  if (!tree) return <Spinner />;
  if (tree.status === 'not-synthesized') {
    return <Box color="text-status-inactive">No cloud assembly found. Run cdk synth first.</Box>;
  }
  return <ConstructTree nodes={tree.tree} onNavigate={onNavigate} />;
}

function ViolationsContent({ violations, onNavigate, filter, onClearFilter, search }: {
  readonly violations?: ViolationsResponse;
  readonly onNavigate: NavigateHandler;
  readonly filter?: string;
  readonly onClearFilter: () => void;
  readonly search: string;
}): JSX.Element {
  if (!violations) return <Spinner />;
  if (violations.status === 'not-synthesized') {
    return <Box color="text-status-inactive">No cloud assembly found.</Box>;
  }
  return <ViolationsPanel violations={violations.violations} onNavigate={onNavigate} filter={filter} onClearFilter={onClearFilter} search={search} />;
}

function ViolationsTitle({ filter, onClearFilter }: { readonly filter?: string; readonly onClearFilter: () => void }): JSX.Element {
  if (!filter) return <>Violations</>;
  const name = filter.split('/').pop() || filter;
  return (
    <span style={VIOLATIONS_TITLE_STYLE}>
      Violations for
      <span style={FILTER_PILL_STYLE}>
        {name}
        <button type="button" style={FILTER_CLEAR_STYLE} onClick={onClearFilter} title="Show all violations">&times;</button>
      </span>
    </span>
  );
}

function ViolationsActions({ search, onSearchChange }: {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
}): JSX.Element {
  return (
    <input
      type="text"
      placeholder="Search"
      value={search}
      onChange={(e) => onSearchChange(e.target.value)}
      style={VIOLATIONS_SEARCH_STYLE}
    />
  );
}

interface SplitOptions {
  readonly orientation: 'horizontal' | 'vertical';
  readonly defaultFraction: number;
  readonly min: number;
  readonly max: number;
}

interface Split extends SplitOptions {
  readonly fraction: number;
  readonly collapsed: boolean;
  readonly toggleCollapsed: () => void;
  readonly startDrag: (e: React.MouseEvent) => void;
  readonly containerRef: React.RefObject<HTMLDivElement>;
}

function useSplit(opts: SplitOptions): Split {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [fraction, setFraction] = React.useState(opts.defaultFraction);
  const [collapsed, setCollapsed] = React.useState(false);

  const startDrag = React.useCallback((e: React.MouseEvent) => {
    if (collapsed) return;
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = opts.orientation === 'vertical' ? 'row-resize' : 'col-resize';
    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
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

function Resizer({ split }: { readonly split: Split }): JSX.Element {
  const isVertical = split.orientation === 'vertical';
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
const GROW_STYLE: React.CSSProperties = { flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%' };

const HEADER_WITH_ACTION_STYLE: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '6px' };
const FOLDER_BUTTON_STYLE: React.CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  padding: '2px',
  color: '#5f6b7a',
  display: 'inline-flex',
  alignItems: 'center',
};
const CODE_PANE_INNER_STYLE: React.CSSProperties = { height: '100%' };
// Source pane stacks an optional staleness banner above the scrolling viewer.
const SOURCE_PANE_COLUMN_STYLE: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  gap: '8px',
};
const PICKER_ANCHOR_STYLE: React.CSSProperties = { position: 'relative', display: 'inline-flex', alignItems: 'center' };
const PICKER_DROPDOWN_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: '4px',
  maxHeight: '50vh',
  minWidth: '320px',
  overflowY: 'auto',
  background: '#ffffff',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  padding: '8px',
  zIndex: 100,
};

const CODE_PANES_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  height: '100%',
};

const CODE_PANE_STYLE: React.CSSProperties = {
  flex: '1 1 50%',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

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

function FormatToggle({ format, onChange }: { readonly format: Format; readonly onChange: (f: Format) => void }): JSX.Element {
  return (
    <span style={FORMAT_TOGGLE_GROUP_STYLE}>
      <button type="button" style={format === 'yaml' ? FORMAT_TOGGLE_ACTIVE_STYLE : FORMAT_TOGGLE_STYLE} onClick={() => onChange('yaml')}>YAML</button>
      <button type="button" style={format === 'json' ? FORMAT_TOGGLE_ACTIVE_STYLE : FORMAT_TOGGLE_STYLE} onClick={() => onChange('json')}>JSON</button>
    </span>
  );
}

function FolderIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 3.5A1.5 1.5 0 012.5 2h3.172a1.5 1.5 0 011.06.44l.658.658A.5.5 0 007.744 3.25H13.5A1.5 1.5 0 0115 4.75v7.75a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
    </svg>
  );
}

const FORMAT_TOGGLE_GROUP_STYLE: React.CSSProperties = { display: 'inline-flex', gap: '2px' };
const FORMAT_TOGGLE_STYLE: React.CSSProperties = {
  border: '1px solid #d1d5db', borderRadius: '4px', background: '#fafafa',
  cursor: 'pointer', fontSize: '11px', padding: '2px 8px', color: '#5f6b7a', lineHeight: '16px',
};
const FORMAT_TOGGLE_ACTIVE_STYLE: React.CSSProperties = {
  ...FORMAT_TOGGLE_STYLE, background: '#0972d3', color: '#ffffff', borderColor: '#0972d3',
};
const VIOLATIONS_TITLE_STYLE: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '6px' };
const FILTER_PILL_STYLE: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '4px',
  background: '#f2f8fd', border: '1px solid #89bdee', borderRadius: '12px',
  padding: '1px 8px 1px 10px', fontSize: '14px', color: '#0972d3', fontWeight: 600,
};
const FILTER_CLEAR_STYLE: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: '14px', lineHeight: 1, color: '#0972d3', padding: '0 2px',
};
const VIOLATIONS_SEARCH_STYLE: React.CSSProperties = {
  width: '160px', padding: '3px 8px', border: '1px solid #d1d5db',
  borderRadius: '4px', fontSize: '13px', outline: 'none',
};

function detectLanguage(file: string | undefined): Language {
  if (!file) return 'typescript';
  if (file.endsWith('.json')) return 'json';
  if (file.endsWith('.yaml') || file.endsWith('.yml')) return 'yaml';
  if (file.endsWith('.py')) return 'python';
  if (file.endsWith('.java')) return 'java';
  if (file.endsWith('.cs')) return 'csharp';
  if (file.endsWith('.go')) return 'go';
  if (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.mjs')) return 'javascript';
  return 'typescript';
}

function buildDiagnostics(
  sourceFile: string | undefined,
  violations: ViolationsResponse | undefined,
): Diagnostic[] | undefined {
  if (!sourceFile || !violations || violations.status !== 'ok' || violations.violations.length === 0) {
    return undefined;
  }
  const diagnostics: Diagnostic[] = [];
  for (const violation of violations.violations) {
    const severity = violationSeverityToDiagnostic(violation.severity);
    for (const occ of violation.occurrences) {
      if (occ.sourceLocation?.file === sourceFile && occ.sourceLocation.line >= 1) {
        diagnostics.push({
          startLine: occ.sourceLocation.line,
          startCol: occ.sourceLocation.column >= 1 ? occ.sourceLocation.column : 1,
          severity,
          message: violation.description,
        });
      }
    }
  }
  return diagnostics.length > 0 ? diagnostics : undefined;
}

function violationSeverityToDiagnostic(severity: string | undefined): 'error' | 'warning' | 'info' {
  switch (severity) {
    case 'fatal':
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}
