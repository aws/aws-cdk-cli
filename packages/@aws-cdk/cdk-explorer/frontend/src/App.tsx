/* eslint-disable @cdklabs/promiseall-no-unbounded-parallelism */
import Alert from '@cloudscape-design/components/alert';
import AppLayoutToolbar from '@cloudscape-design/components/app-layout-toolbar';
import Box from '@cloudscape-design/components/box';
import Select from '@cloudscape-design/components/select';
import Spinner from '@cloudscape-design/components/spinner';
import SplitPanel from '@cloudscape-design/components/split-panel';
import Tabs from '@cloudscape-design/components/tabs';
import * as awsui from '@cloudscape-design/design-tokens';
import * as React from 'react';
import { api } from './api';
import { CodeViewer, type Diagnostic } from './components/CodeViewer';
import { ConstructTree, ExpandState } from './components/ConstructTree';
import { Flex, FlexFix, FlexGrow } from './components/Flex';
import { Help } from './components/Help';
import { LightDarkToggle } from './components/LightDarkToggle';
import { RelativeTime } from './components/RelativeTime';
import { colorForSeverity } from './components/severities';
import { FormatToggle, TemplateViewer, type Format } from './components/TemplateViewer';
import { diagnosticsPanelTitle, filterViolations, ViolationsConstructFilter, ViolationsPanelContent, ViolationsSearch } from './components/ViolationsPanel';
import type { NavigateHandler } from './nav-types';
import { SourceAndTemplateIndex } from './source-and-template-index';
import type { Language } from './syntax';
import { type TemplateResponse, type TreeResponse, type ViolationsResponse } from '../../lib/web-shared/protocol';
export type { NavigateHandler } from './nav-types';

interface SourceHighlight {
  startLine: number;
  endLine: number;
  color: string;
}

interface TemplateHighlight {
  logicalId: string;
  color: string;
}

interface SourceFile {
  fileName: string;
  content: string;
  stale: boolean;
}

interface TemplateFile {
  fileName: string;
  response: TemplateResponse;
}

let didInit = false;

/** Web explorer shell. */
export function App(): JSX.Element {
  const expandState = React.useRef(new ExpandState());
  const [, expandStateChanged] = React.useState({});

  const [tree, setTree] = React.useState<TreeResponse | undefined>();
  const [violations, setViolations] = React.useState<ViolationsResponse | undefined>();
  const [error, setError] = React.useState<string | undefined>();
  const [appDir, setAppDir] = React.useState<string | undefined>();

  const [treeHighlight, setTreeHighlight] = React.useState<string | undefined>();

  // Source pane state.
  const [sourceFile, setSourceFile] = React.useState<SourceFile | undefined>();
  const [sourceHighlight, setSourceHighlight] = React.useState<SourceHighlight | undefined>();
  const [templateFile, setTemplateFile] = React.useState<TemplateFile | undefined>();
  const [templateHighlight, setTemplateHighlight] = React.useState<TemplateHighlight | undefined>();
  const [templateFormat, setTemplateFormat] = React.useState<Format>('yaml');

  // Violations filter: when set, only violations affecting this construct path are shown.
  const [violationFilter, setViolationFilter] = React.useState<string | undefined>();
  const [violationSearch, setViolationSearch] = React.useState('');

  const filteredViolations = React.useMemo(() => {
    if (!violations || violations.status !== 'ok') return [];
    return filterViolations(violations.violations, violationFilter, violationSearch);
  }, [violations, violationFilter, violationSearch]);

  const constructIndex = React.useRef(new SourceAndTemplateIndex());

  const reload = React.useCallback(async () => {
    try {
      const firstLoad = tree === undefined || tree.status !== 'ok';

      const [t, v, info] = await Promise.all([api.getTree(), api.getViolations(), api.getAppInfo()]);

      setTree(t);
      if (t.status === 'ok') {
        constructIndex.current = new SourceAndTemplateIndex();
        constructIndex.current.addTree(t.tree);
        if (firstLoad) {
          expandState.current.autoExpand(2, t.tree);
          expandStateChanged({});
        }
      }

      setViolations(v);
      setAppDir(info.appDir);
      setError(undefined);

      if (v.status === 'ok' && v.violations.length > 0) {
        setDiagnosticsOpen(true);
      }
    } catch (err) {
      // Keep the last good render on a transient read (e.g. a mid-synth write);
      // the next assembly-changed event re-fetches once the write has settled.
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Re-read the currently open source file, refreshing both its content and its
  // staleness flag. Used after a synth (assembly changed) to clear a banner, and
  // on a source edit to raise one, without the user re-opening the file.
  const refreshOpenSourceFile = React.useCallback(async (): Promise<void> => {
    const file = sourceFile;
    if (!file) return;
    await navigateToSourceFile(file.fileName, 'refresh');
    try {
      const res = await api.readFile(file.fileName);
      setSourceFile({
        fileName: file.fileName,
        content: res.content,
        stale: res.stale,
      });
    } catch {
      // Keep the last good content; a later event re-tries.
    }
  }, []);

  React.useEffect(() => {
    // useEffect runs twice, guard against double initialization
    if (didInit) {
      return;
    }
    void reload();

    return api.subscribe({
      onAssemblyChanged: () => {
        void reload();
        void refreshOpenSourceFile();
      },
      onSourceChanged: () => {
        void refreshOpenSourceFile();
      },
    });
  }, []);

  /** Navigate to a construct (from tree double-click or violation double-click). */
  const onNavigate: NavigateHandler = React.useCallback(async (opts) => {
    const construct = constructIndex.current.construct(opts.constructPath);
    if (!construct) {
      return;
    }

    if (opts.trigger === 'tree') {
      // Filter diagnostics, only if the user clicked the tree
      setViolationFilter(opts.constructPath);
    }

    if (opts.trigger !== 'tree') {
      // Setting to 'undefined' first followed by a redraw will make sure the highlight flashes
      expandState.current.ensureParentsExpanded(construct.path);
      setTreeHighlight(undefined);
      setTimeout(() => setTreeHighlight(construct.path), 0);
    }

    const color = colorForSeverity(construct.highestSeverity);
    if (opts.trigger !== 'source') {
      if (construct.sourceLocation) {
        // Setting to 'undefined' first followed by a redraw (forced by the 'await') will make sure the highlight flashes
        setSourceHighlight(undefined);
        await navigateToSourceFile(construct.sourceLocation.file, 'nav');
        setSourceHighlight({
          startLine: construct.sourceLocation.line,
          endLine: construct.sourceLocation.line,
          color,
        });
      }
    }

    if (opts.trigger !== 'template') {
      if (construct.templateLocation) {
        // Setting to 'undefined' first followed by a redraw (forced by the 'await') will make sure the highlight flashes
        setTemplateHighlight(undefined);
        await navigateToTemplateFile(construct.templateLocation.file, 'nav');
        setTemplateHighlight({
          logicalId: construct.templateLocation.logicalId,
          color,
        });
      }
    }
    // This must have the same dependencies as constructIndex!
  }, [tree]);

  /** Jump from template pane to source (the "Open in source" button). */
  const jumpToSource = React.useCallback(async (logicalId: string) => {
    const data = templateFile?.response;
    if (!data) return;
    const resource = data.resources[logicalId];
    if (!resource?.source) return;

    await navigateToSourceFile(resource.source.file, 'nav');
    /*
    setNav({
      source: { file: resource.source.file, startLine: resource.source.line, endLine: resource.source.line },
      template: undefined,
      color: colorForSeverity(undefined),
    });
    */
  }, []);

  const navigateToSourceFile = React.useCallback(async (fileName: string, mode: 'nav' | 'refresh') => {
    if (sourceFile?.fileName !== fileName || mode === 'refresh') {
      try {
        const res = await api.readFile(fileName);
        setSourceFile({
          fileName: res.path,
          content: res.content,
          stale: res.stale,
        });
      } catch {
        // Show a failure if explicit, otherwise just show current contents
        if (mode === 'nav') {
          setSourceFile({
            fileName,
            content: `// Could not load ${fileName}`,
            stale: false,
          });
        }
      }
    }
  }, [sourceFile]);

  const navigateToTemplateFile = React.useCallback(async (fileName: string, mode: 'nav' | 'refresh') => {
    if (templateFile?.fileName !== fileName || mode === 'refresh') {
      try {
        const response = await api.getTemplate(fileName);
        setTemplateFile({
          fileName,
          response,
        });
      } catch {
        setTemplateFormat('yaml');
        setTemplateFile({
          fileName,
          response: {
            content: `# Could not load ${fileName}`,
            resources: {},
          },
        });
      }
    }
  }, [templateFile]);

  /** Double-click a line in the source pane to jump to its resource in the template. */
  const handleSourceDoubleClick = React.useCallback((line: number) => {
    const file = sourceFile?.fileName;
    if (!file) return;
    const node = constructIndex.current.findBySourceLocation(file, line);
    if (!node) return;
    void onNavigate({
      trigger: 'source',
      constructPath: node.path,
    });
  }, [sourceFile, constructIndex.current, onNavigate]);

  const pickFile = React.useCallback(async (filePath: string, pane: 'source' | 'template') => {
    try {
      if (pane === 'source') {
        await navigateToSourceFile(filePath, 'nav');
      } else {
        await navigateToTemplateFile(filePath, 'nav');
      }
    } catch {
      /* ignore */
    }
  }, []);

  const [navigationOpen, setNavigationOpen] = React.useState(true);
  const [activeDrawer, setActiveDrawer] = React.useState<'template' | 'help' | undefined>('template');
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(violations ? violations.status === 'ok' && violations.violations.length > 0 : false);

  return (
    <div id="toolbarHijack" style={{ height: '100%' }}>
      <AppLayoutToolbar
        breadcrumbs={
          /* ================= Toolbar =========================== */
          <Flex style={{ width: '100%' }}>
            <FlexFix style={{ fontWeight: 'bold' }}>CDK Explorer</FlexFix>
            <FlexFix style={{ fontWeight: 'light' }}>{appDir ?? ''}</FlexFix>
            <FlexFix style={{ fontSize: 'small', color: awsui.colorTextInputDisabled }}>
              {tree?.status === 'ok' ? <>(synthesized <RelativeTime timestamp={tree.timestamp} />)</> : ''}
            </FlexFix>
          </Flex>
        }

        contentType='table'
        disableContentPaddings={true}

        navigation={
          /* ================= Construct Tree =========================== */
          <Tabs
            fitHeight={true}
            tabs={[{
              label: 'Construct Tree',
              id: 'tree',
              content: (
                <ConstructTreeContent
                  tree={tree}
                  onNavigate={onNavigate}
                  expandState={expandState.current}
                  highlightedConstructPath={treeHighlight} />
              ),
            }]}
          />
        }
        navigationOpen={navigationOpen}
        onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
        navigationWidth={350}

        notifications={<>
          {(error && <Box color="text-status-error">{error}</Box>)}
          {(sourceFile?.stale ? (<div style={{ marginBottom: '8px' }}>
            <Alert type="warning">
              This file has been modified since the last synth, so
              its diagnostics and source locations may be stale.
              Re-run <code>cdk synth</code> to refresh.
            </Alert>
          </div>) : null)}
        </>}

        content={
          /* ================= Source View =========================== */
          <div style={{ backgroundColor: awsui.colorBackgroundContainerContent, height: '100%', overflow: 'auto' }} id="contentRoot">
            <Tabs
              tabs={[{
                label: 'Source View',
                id: 'source',
                content: (
                  <div style={{ padding: '0px 16px' }} id="tabRoot">
                    <div style={{ marginBottom: '8px' }}>
                      <Select
                        placeholder="Source file"
                        selectedOption={sourceFile?.fileName ? { label: sourceFile.fileName, value: sourceFile.fileName } : null}
                        onChange={({ detail }) => detail.selectedOption.value ? pickFile(detail.selectedOption.value, 'source') : undefined}
                        options={constructIndex.current.sourceFiles.map(f => ({ label: f, value: f }))}
                      />
                    </div>
                    <div>
                      {sourceFile ? (
                        <>
                          <CodeViewer
                            content={sourceFile.content}
                            language={detectLanguage(sourceFile.fileName)}
                            highlightStart={sourceHighlight?.startLine}
                            highlightEnd={sourceHighlight?.endLine}
                            highlightColor={sourceHighlight?.color}
                            scrollToLine={sourceHighlight?.startLine}
                            onLineDoubleClick={handleSourceDoubleClick}
                            diagnostics={buildDiagnostics(sourceFile.fileName, violations)}
                          />
                        </>
                      ) : (
                        <Box color="text-status-inactive">Select a construct from the tree to view source here.</Box>
                      )}
                    </div>
                  </div>),
              }]}
            />
          </div>
        }

        tools={<Help />}

        activeDrawerId={activeDrawer}
        drawers={[
          {
            id: 'template',
            content: (
              /* ================= Template View =========================== */
              <Tabs
                fitHeight={true}
                tabs={[{
                  label: 'Template View',
                  id: 'template',
                  content: (
                    <div style={{ padding: '0px 16px' }}>
                      <Flex style={{ marginBottom: '8px' }}>
                        <FlexGrow>
                          <Select
                            placeholder="Template file"
                            selectedOption={templateFile?.fileName ? { label: templateFile.fileName, value: templateFile.fileName } : null}
                            onChange={({ detail }) => detail.selectedOption.value ? pickFile(detail.selectedOption.value, 'template') : undefined}
                            options={constructIndex.current.templateFiles.map(f => ({ label: f, value: f }))}
                          />
                        </FlexGrow>
                        {templateFile && (
                          <FlexFix>
                            <FormatToggle format={templateFormat} onChange={setTemplateFormat} />
                          </FlexFix>
                        )}
                      </Flex>
                      <div>
                        {templateFile ? (
                          <TemplateViewer
                            jsonContent={templateFile.response.content}
                            resources={templateFile.response.resources}
                            highlightLogicalId={templateHighlight?.logicalId}
                            highlightColor={templateHighlight?.color}
                            onResourceDoubleClick={jumpToSource}
                            templateFile={templateFile.fileName}
                            violations={violations?.status === 'ok' ? violations.violations : undefined}
                            format={templateFormat}
                          />
                        ) : (
                          <Box color="text-status-inactive">Select a construct to view its template.</Box>
                        )}
                      </div>
                    </div>
                  ),
                }]}
              />
            ),
            resizable: true,
            defaultSize: 600,
            trigger: {
              iconName: 'file-open',
            },
            ariaLabels: {
              drawerName: 'Template',
            },
          },
          {
            id: 'help',
            content: (
              <Help />
            ),
            resizable: true,
            defaultSize: 500,
            trigger: {
              iconName: 'status-info',
            },
            ariaLabels: {
              drawerName: 'Help',
            },
          },
        ]}
        onDrawerChange={(detail) => {
          setActiveDrawer(detail.detail.activeDrawerId as any);
        }}

        splitPanelOpen={diagnosticsOpen}
        onSplitPanelToggle={(detail) => setDiagnosticsOpen(!diagnosticsOpen)}
        splitPanel={
          /* ================= Diagnostics =========================== */
          <SplitPanel
            header={diagnosticsPanelTitle(violations, filteredViolations)}
            ariaLabel='Diagnostics'
            hidePreferencesButton={true}
            headerActions={
              <Flex style={{ justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <ViolationsConstructFilter constructPathFilter={violationFilter} onClearFilter={() => setViolationFilter(undefined)} />
                <ViolationsSearch search={violationSearch} onSearchChange={setViolationSearch} />
              </Flex>
            }
          >

            <ViolationsPanelContent
              status={violations?.status}
              violations={filteredViolations}
              onNavigate={onNavigate}
            />
          </SplitPanel>}
        ariaLabels={{
        }}
      >
      </AppLayoutToolbar>
      {/* ================= Faux Toolbar =========================== */}
      <div style={{ position: 'absolute', top: 5, right: 136, zIndex: 1000 }}>
        <LightDarkToggle/>
      </div>
    </div>
  );
}

function ConstructTreeContent(
  { tree, onNavigate, expandState, highlightedConstructPath }:
  {
    readonly tree?: TreeResponse;
    readonly onNavigate: NavigateHandler;
    readonly expandState: ExpandState;
    readonly highlightedConstructPath?: string;
  },
): JSX.Element {
  if (!tree) return <Spinner />;
  if (tree.status === 'not-synthesized') {
    return <Box color="text-status-inactive">No cloud assembly found. Run cdk synth first.</Box>;
  }
  return <ConstructTree expandState={expandState} nodes={tree.tree} onNavigate={onNavigate} highlightedConstructPath={highlightedConstructPath} />;
}

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
): Diagnostic[] {
  if (!sourceFile || !violations || violations.status !== 'ok' || violations.violations.length === 0) {
    return undefined;
  }
  const diagnostics: Diagnostic[] = [];
  for (const violation of violations.violations) {
    const severity = violationSeverityToDiagnostic(violation.severity);
    for (const occ of violation.occurrences) {
      for (const sourceLocation of occ.sourceLocations ?? []) {
        if (sourceLocation.file === sourceFile && sourceLocation.line >= 1) {
          diagnostics.push({
            startLine: sourceLocation.line,
            startCol: sourceLocation.column >= 1 ? sourceLocation.column : 1,
            severity,
            message: violation.description,
          });
        }
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
