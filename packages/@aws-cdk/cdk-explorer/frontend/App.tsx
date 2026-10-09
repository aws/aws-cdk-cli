/* eslint-disable @cdklabs/promiseall-no-unbounded-parallelism */
import Alert from '@cloudscape-design/components/alert';
import AppLayoutToolbar from '@cloudscape-design/components/app-layout-toolbar';
import Box from '@cloudscape-design/components/box';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import SplitPanel from '@cloudscape-design/components/split-panel';
import Tabs from '@cloudscape-design/components/tabs';
import TextFilter from '@cloudscape-design/components/text-filter';
import Token from '@cloudscape-design/components/token';
import * as awsui from '@cloudscape-design/design-tokens';
import * as React from 'react';
import { api, type TemplateResponse, type TreeResponse, type ViolationsResponse } from './api';
import { CodeViewer, type Diagnostic } from './components/CodeViewer';
import { ConstructTree, ExpandState } from './components/ConstructTree';
import { Flex, FlexFix, FlexGrow } from './components/Flex';
import { LightDarkToggle } from './components/LightDarkToggle';
import { RelativeTime } from './components/RelativeTime';
import { colorForSeverity } from './components/severities';
import { FormatToggle, TemplateViewer, type Format } from './components/TemplateViewer';
import { ViolationsPanel } from './components/ViolationsPanel';
import { ConstructIndex } from './construct-index';
import type { NavigateHandler } from './nav-types';
import type { Language } from './syntax';
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

/** Web explorer shell. */
export function App(): JSX.Element {
  const expandState = React.useRef(new ExpandState());
  const [, expandStateChanged] = React.useState({});

  const [tree, setTree] = React.useState<TreeResponse | undefined>();
  const [violations, setViolations] = React.useState<ViolationsResponse | undefined>();
  const [error, setError] = React.useState<string | undefined>();
  const [appDir, setAppDir] = React.useState<string | undefined>();

  // Source pane state.
  const [sourceFile, setSourceFile] = React.useState<SourceFile | undefined>();
  const [sourceHighlight, setSourceHighlight] = React.useState<SourceHighlight | undefined>();
  const [templateFile, setTemplateFile] = React.useState<TemplateFile | undefined>();
  const [templateHighlight, setTemplateHighlight] = React.useState<TemplateHighlight | undefined>();
  const [templateFormat, setTemplateFormat] = React.useState<Format>('yaml');

  // Violations filter: when set, only violations affecting this construct path are shown.
  const [violationFilter, setViolationFilter] = React.useState<string | undefined>();
  const [violationSearch, setViolationSearch] = React.useState('');

  const constructIndex = React.useRef(new ConstructIndex());

  const [reloadSequence, triggerReload] = React.useState(0);
  React.useEffect(() => {
    const seqStart = reloadSequence;
    void (async() => {
      try {
        const firstLoad = tree === undefined || tree.status !== 'ok';

        const [t, v, info] = await Promise.all([api.getTree(), api.getViolations(), api.getAppInfo()]);
        if (seqStart !== reloadSequence) {
          return;
        }

        setTree(t);
        if (t.status === 'ok') {
          constructIndex.current = new ConstructIndex();
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
    })();
  }, [reloadSequence]);

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
    console.log('startup effect');
    triggerReload(i => i + 1);
    return api.subscribe({
      onAssemblyChanged: () => {
        triggerReload(i => i + 1);
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

    const color = colorForSeverity(construct.highestSeverity);
    if (opts.trigger !== 'source') {
      if (construct.sourceLocation) {
        setSourceHighlight({
          startLine: construct.sourceLocation.line,
          endLine: construct.sourceLocation.line,
          color,
        });
        await navigateToSourceFile(construct.sourceLocation.file, 'nav');
      }
    }

    if (opts.trigger !== 'template') {
      if (construct.templateLocation) {
        setTemplateHighlight({
          logicalId: construct.templateLocation.logicalId,
          color,
        });
        await navigateToTemplateFile(construct.templateLocation.file, 'nav');
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
  const [drawerOpen, setDrawerOpen] = React.useState(true);
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(violations ? violations.status === 'ok' && violations.violations.length > 0 : false);

  return (
    <div>
      <AppLayoutToolbar breadcrumbs={
        <Flex style={{ width: '100%' }}>
          <FlexFix style={{ fontWeight: 'bold' }}>CDK Explorer</FlexFix>
          <FlexFix style={{ fontWeight: 'light' }}>{appDir ?? ''}</FlexFix>
          <FlexFix style={{ fontSize: 'small', color: awsui.colorTextInputDisabled }}>
            {tree?.status === 'ok' ? <>(synthesized <RelativeTime timestamp={tree.timestamp} />)</> : '' }
          </FlexFix>
        </Flex>
      }
      navigationOpen={navigationOpen}
      onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
      navigationWidth={350}

      navigation={
        <Tabs
          fitHeight={true}
          tabs={[{
            label: 'Construct Tree',
            id: 'tree',
            content: (
              <ConstructTreeContent tree={tree} onNavigate={onNavigate} expandState={expandState.current} />
            ),
          }]}
        />
      }
      contentType='table'
      disableContentPaddings={true}
      content={
        <div style={{ backgroundColor: awsui.colorBackgroundContainerContent }}>
          {error && <Box color="text-status-error">{error}</Box>}
          <Tabs
            fitHeight={true}
            tabs={[{
              label: 'Source View',
              id: 'source',
              content: (
                <div style={{ padding: '0px 16px', minHeight: '800px' }}>
                  <div style={{ marginBottom: '8px' }}>
                    <Select
                      placeholder="Source file"
                      selectedOption={sourceFile?.fileName ? { label: sourceFile.fileName, value: sourceFile.fileName } : null}
                      onChange={({ detail }) => detail.selectedOption.value ? pickFile(detail.selectedOption.value, 'source') : undefined}
                      options={constructIndex.current.sourceFiles.map(f => ({ label: f, value: f }))}
                    />
                  </div>
                  <div style={CODE_PANE_INNER_STYLE}>
                    {sourceFile ? (
                      <SpaceBetween size='xs'>
                        {sourceFile.stale && (
                          <Alert type="warning">
                            This file has been modified since the last synth, so
                            its diagnostics and source locations may be stale.
                            Re-run <code>cdk synth</code> to refresh.
                          </Alert>
                        )}
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
                      </SpaceBetween>
                    ) : (
                      <Box color="text-status-inactive">Select a construct from the tree to view source here.</Box>
                    )}
                  </div>
                </div>),
            }]}
          />
        </div>
      }

      activeDrawerId={drawerOpen ? 'template' : null}
      drawers={[
        {
          id: 'template',
          content: (
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
                    <div style={CODE_PANE_INNER_STYLE}>
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
      ]}
      onDrawerChange={(detail) => {
        setDrawerOpen(!drawerOpen);
      }}

      splitPanelOpen={diagnosticsOpen}
      onSplitPanelToggle={(detail) => setDiagnosticsOpen(!diagnosticsOpen)}
      splitPanel={
        <SplitPanel header={`Diagnostics (${violations?.status === 'ok' ? violations.violations.length : 0})`}
          ariaLabel='Diagnostics'
          hidePreferencesButton={true}
          headerActions={
            <Flex style={{ justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <ViolationsConstructFilter filter={violationFilter} onClearFilter={() => setViolationFilter(undefined)} />
              <ViolationsSearch search={violationSearch} onSearchChange={setViolationSearch} />
            </Flex>
          }
        >

          <ViolationsContent
            violations={violations}
            onNavigate={onNavigate}
            filter={violationFilter}
            onClearFilter={() => setViolationFilter(undefined)} search={violationSearch}
          />
        </SplitPanel>}
      ariaLabels={{
      }}
      >

      </AppLayoutToolbar>
      { /* Faux toolbar */ }
      <div style={{ position: 'absolute', top: 5, right: 92, zIndex: 1000 }}>
        <LightDarkToggle/>
      </div>
    </div>
  );
}

function ConstructTreeContent(
  { tree, onNavigate, expandState }:
  { readonly tree?: TreeResponse; readonly onNavigate: NavigateHandler; readonly expandState: ExpandState },
): JSX.Element {
  if (!tree) return <Spinner />;
  if (tree.status === 'not-synthesized') {
    return <Box color="text-status-inactive">No cloud assembly found. Run cdk synth first.</Box>;
  }
  return <ConstructTree expandState={expandState} nodes={tree.tree} onNavigate={onNavigate} />;
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

function ViolationsConstructFilter({ filter, onClearFilter }: { readonly filter?: string; readonly onClearFilter: () => void }): JSX.Element {
  if (!filter) return <></>;
  const name = filter.split('/').pop() || filter;
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

function ViolationsSearch({ search, onSearchChange }: {
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

const CODE_PANE_INNER_STYLE: React.CSSProperties = { height: '100%' };

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
