import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Toggle from '@cloudscape-design/components/toggle';
import * as React from 'react';
import { buildSourceAnchorIndex, findConstructAtLine } from '../lib/web/source-nav';
import { api, type DirEntry, type SynthResult, type SynthStatusEvent, type TemplateResponse, type TreeResponse, type ViolationsResponse } from './api';
import { CodeViewer, type Diagnostic } from './components/CodeViewer';
import { ConstructTree } from './components/ConstructTree';
import type { Language } from './syntax';
import { TemplateViewer } from './components/TemplateViewer';
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

  // Auto-synth + manual synth state.
  const [autoSynthEnabled, setAutoSynthEnabled] = React.useState(false);
  const [synthing, setSynthing] = React.useState(false);
  const [synthFailure, setSynthFailure] = React.useState<SynthStatusEvent | undefined>();
  const [showFailureModal, setShowFailureModal] = React.useState(false);
  const [synthWarning, setSynthWarning] = React.useState<string | undefined>();
  const [lastSynthTime, setLastSynthTime] = React.useState<string | undefined>();

  // Source pane state.
  const [sourceFile, setSourceFile] = React.useState<string | undefined>();
  const [sourceContent, setSourceContent] = React.useState('');

  // Template pane state.
  const [templateFile, setTemplateFile] = React.useState<string | undefined>();
  const [templateData, setTemplateData] = React.useState<TemplateResponse | undefined>();

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

  const reload = React.useCallback((): void => {
    Promise.all([api.getTree(), api.getViolations(), api.getAppInfo()])
      .then(([t, v, info]) => {
        setTree(t);
        setViolations(v);
        setAppDir(info.appDir);
        setError(undefined);
        setSynthFailure(undefined);
        setSynthWarning(undefined);
        setLastSynthTime(new Date().toLocaleTimeString());
      })
      // Keep the last good render on a transient read (e.g. a mid-synth write);
      // the next assembly-changed event re-fetches once the write has settled.
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  React.useEffect(() => {
    reload();
    void api.getAutoSynth().then((r) => setAutoSynthEnabled(r.enabled)).catch(() => undefined);
    return api.subscribe({
      onAssemblyChanged: reload,
      onSynthFailure: (event) => {
        setSynthFailure(event);
        setShowFailureModal(false);
        setLastSynthTime(new Date().toLocaleTimeString());
      },
    });
  }, [reload]);

  /** Toggle auto-synth-on-save; optimistic, reverts if the server rejects. */
  const toggleAutoSynth = React.useCallback(async (enabled: boolean) => {
    setAutoSynthEnabled(enabled);
    try {
      const res = await api.setAutoSynth(enabled);
      setAutoSynthEnabled(res.enabled);
    } catch {
      setAutoSynthEnabled(!enabled);
    }
  }, []);

  /** Run a manual synth. Failures surface via the SYNTH_STATUS subscription. */
  const handleSynth = React.useCallback(async () => {
    setSynthing(true);
    setSynthWarning(undefined);
    try {
      const result: SynthResult = await api.synth();
      if (result.status === 'lock-conflict') {
        setSynthWarning('Synth skipped — already running');
      } else if (result.status === 'unavailable') {
        setSynthWarning('No app configured (missing cdk.json)');
      }
    } catch {
      /* hard failures surfaced via onSynthFailure SSE */
    } finally {
      setSynthing(false);
    }
  }, []);

  /** Navigate to a construct (from tree double-click or violation double-click). */
  const navigate: NavigateHandler = React.useCallback(async (opts) => {
    const counter = ++navCounterRef.current;
    const color = opts.color ?? NEUTRAL_COLOR;

    let sourceTarget: NavTarget['source'];
    if (opts.sourceLocation) {
      sourceTarget = { file: opts.sourceLocation.file, startLine: opts.sourceLocation.line, endLine: opts.sourceLocation.line };
      if (sourceFileRef.current !== opts.sourceLocation.file) {
        try {
          const res = await api.readFile(opts.sourceLocation.file);
          setSourceFile(res.path);
          setSourceContent(res.content);
        } catch {
          setSourceFile(opts.sourceLocation.file);
          setSourceContent(`// Could not load ${opts.sourceLocation.file}`);
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
    });
  }, [sourceAnchors, navigate]);

  // File picker state.
  const [showFilePicker, setShowFilePicker] = React.useState<false | 'source' | 'template'>(false);
  const [pickerDir, setPickerDir] = React.useState('');
  const [pickerEntries, setPickerEntries] = React.useState<readonly DirEntry[]>([]);

  const openFilePicker = React.useCallback(async (pane: 'source' | 'template') => {
    setShowFilePicker(pane);
    try {
      const res = await api.listFiles('');
      setPickerDir(res.dir);
      setPickerEntries(res.entries);
    } catch { /* ignore */ }
  }, []);

  const browseDir = React.useCallback(async (dir: string) => {
    try {
      const res = await api.listFiles(dir);
      setPickerDir(res.dir);
      setPickerEntries(res.entries);
    } catch { /* ignore */ }
  }, []);

  const pickFile = React.useCallback(async (filePath: string, pane: 'source' | 'template') => {
    try {
      const res = await api.readFile(filePath);
      if (pane === 'source') {
        setSourceFile(res.path);
        setSourceContent(res.content);
      } else {
        setTemplateFile(res.path);
        setTemplateData({ content: res.content, resources: {} });
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
        <Header
          variant="h1"
          description={appDir ?? '—'}
          actions={
            <SpaceBetween direction="horizontal" size="s" alignItems="center">
              <Toggle checked={autoSynthEnabled} onChange={({ detail }) => void toggleAutoSynth(detail.checked)}>
                Auto-synth on save
              </Toggle>
              <Button disabled={autoSynthEnabled} loading={synthing} onClick={() => void handleSynth()}>Synth</Button>
            </SpaceBetween>
          }
        >
          CDK Web Explorer
        </Header>
        {(synthFailure || synthWarning || lastSynthTime) && (
          <div style={SYNTH_STATUS_ROW_STYLE}>
            {synthFailure && (
              <Link onFollow={() => setShowFailureModal(true)} variant="secondary">
                <StatusIndicator type="error">Synth failed</StatusIndicator>
              </Link>
            )}
            {!synthFailure && synthWarning && (
              <StatusIndicator type="warning">{synthWarning}</StatusIndicator>
            )}
            {lastSynthTime && (
              <span style={{ color: '#5f6b7a' }}>Last synth at {lastSynthTime}</span>
            )}
          </div>
        )}
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
                  <span style={HEADER_WITH_ACTION_STYLE}>
                    {sourceFile ?? 'Source'}
                    <button type="button" style={OPEN_FILE_BUTTON_STYLE} title={showFilePicker === 'source' ? 'Close picker' : 'Open file'} aria-label="Open file" onClick={() => showFilePicker === 'source' ? setShowFilePicker(false) : void openFilePicker('source')}>Open</button>
                  </span>
                </Header>
              }>
                {showFilePicker === 'source' ? (
                  <FilePicker dir={pickerDir} entries={pickerEntries} onBrowse={browseDir} onPick={(p) => void pickFile(p, 'source')} />
                ) : sourceContent ? (
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
                ) : (
                  <Box color="text-status-inactive">Double-click a construct to view its source.</Box>
                )}
              </Container>
            </div>
            <div style={CODE_PANE_STYLE}>
              <Container fitHeight header={
                <Header variant="h2">
                  <span style={HEADER_WITH_ACTION_STYLE}>
                    {templateFile ?? 'Template'}
                    <button type="button" style={OPEN_FILE_BUTTON_STYLE} title={showFilePicker === 'template' ? 'Close picker' : 'Open file'} aria-label="Open template file" onClick={() => showFilePicker === 'template' ? setShowFilePicker(false) : void openFilePicker('template')}>Open</button>
                  </span>
                </Header>
              }>
                {showFilePicker === 'template' ? (
                  <FilePicker dir={pickerDir} entries={pickerEntries} onBrowse={browseDir} onPick={(p) => void pickFile(p, 'template')} />
                ) : templateData ? (
                  <TemplateViewer
                    jsonContent={templateData.content}
                    resources={templateData.resources}
                    highlightLogicalId={nav?.template?.logicalId}
                    highlightColor={nav?.color}
                    navCounter={nav?.navCounter}
                    onResourceDoubleClick={jumpToSource}
                  />
                ) : templateFile ? (
                  <Box color="text-status-error">Could not load {templateFile}</Box>
                ) : (
                  <Box color="text-status-inactive">Double-click a construct to view its template.</Box>
                )}
              </Container>
            </div>
          </div>
        </div>
      </div>
      <div style={bottomRowStyle(vSplit)}>
        <Resizer split={vSplit} />
        {!vSplit.collapsed && (
          <div style={GROW_STYLE}>
            <Container fitHeight header={<Header variant="h2">Violations</Header>}>
              <ViolationsContent violations={violations} onNavigate={navigate} />
            </Container>
          </div>
        )}
      </div>
      {synthFailure && showFailureModal && (
        <Modal
          visible
          onDismiss={() => setShowFailureModal(false)}
          size="large"
          header="Synth failed"
          footer={<Box float="right"><Button variant="primary" onClick={() => setShowFailureModal(false)}>Close</Button></Box>}
        >
          <SpaceBetween size="s">
            <Box color="text-status-error">{synthFailure.message}</Box>
            {synthFailure.details && <pre style={SYNTH_LOG_STYLE}>{synthFailure.details}</pre>}
          </SpaceBetween>
        </Modal>
      )}
    </div>
  );
}


function FilePicker({ dir, entries, onBrowse, onPick }: {
  readonly dir: string;
  readonly entries: readonly DirEntry[];
  readonly onBrowse: (dir: string) => void;
  readonly onPick: (path: string) => void;
}): JSX.Element {
  return (
    <SpaceBetween size="xxs">
      <Box variant="code">/{dir}</Box>
      {dir !== '' && <Button variant="inline-link" iconName="folder" onClick={() => onBrowse(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '')}>../</Button>}
      {entries.map((entry) => (
        <Button
          key={entry.path}
          variant="inline-link"
          iconName={entry.type === 'dir' ? 'folder' : 'file'}
          onClick={() => entry.type === 'dir' ? onBrowse(entry.path) : onPick(entry.path)}
        >
          {entry.type === 'dir' ? `${entry.name}/` : entry.name}
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

function ViolationsContent({ violations, onNavigate }: { readonly violations?: ViolationsResponse; readonly onNavigate: NavigateHandler }): JSX.Element {
  if (!violations) return <Spinner />;
  if (violations.status === 'not-synthesized') {
    return <Box color="text-status-inactive">No cloud assembly found.</Box>;
  }
  return <ViolationsPanel violations={violations.violations} onNavigate={onNavigate} />;
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
const TITLE_BLOCK_STYLE: React.CSSProperties = { flexShrink: 0, marginBottom: '12px', position: 'relative' };
const SYNTH_STATUS_ROW_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: 0,
  right: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontFamily: '"Open Sans", "Helvetica Neue", Roboto, Arial, sans-serif',
  fontSize: '14px',
};
const GROW_STYLE: React.CSSProperties = { flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%' };
const SYNTH_LOG_STYLE: React.CSSProperties = {
  margin: 0,
  maxHeight: '50vh',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  fontFamily: 'monospace',
  fontSize: '12px',
  background: '#f4f4f4',
  padding: '8px',
  borderRadius: '4px',
};

const HEADER_WITH_ACTION_STYLE: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '6px' };
const OPEN_FILE_BUTTON_STYLE: React.CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  background: '#fafafa',
  cursor: 'pointer',
  fontSize: '11px',
  padding: '1px 6px',
  color: '#5f6b7a',
  lineHeight: '16px',
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
