import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import * as React from 'react';
import { api, type TreeResponse, type ViolationsResponse } from './api';
import { ConstructTree } from './components/ConstructTree';
import { FilePane } from './components/FilePane';
import { ViolationsPanel } from './components/ViolationsPanel';

/** Web explorer shell: Resource Tree (left), two file panes, Violations (bottom). */
export function App(): JSX.Element {
  const [tree, setTree] = React.useState<TreeResponse | undefined>();
  const [violations, setViolations] = React.useState<ViolationsResponse | undefined>();
  const [error, setError] = React.useState<string | undefined>();
  const [updatedAt, setUpdatedAt] = React.useState('—');

  const load = React.useCallback(async () => {
    try {
      const [t, v] = await Promise.all([api.getTree(), api.getViolations()]);
      setTree(t);
      setViolations(v);
      setUpdatedAt(new Date().toLocaleTimeString());
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const [treeWidth, setTreeWidth] = React.useState(340);
  const startResize = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = treeWidth;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: MouseEvent) => {
      setTreeWidth(Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, startWidth + ev.clientX - startX)));
    };
    const onUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [treeWidth]);

  return (
    <ContentLayout
      header={<Header variant="h1" description={`last updated: ${updatedAt}`}>CDK Web Explorer</Header>}
    >
      <SpaceBetween size="l">
        {error && <Box color="text-status-error">{error}</Box>}
        <div style={SPLIT_ROW_STYLE}>
          <div style={{ width: `${treeWidth}px`, flexShrink: 0, minWidth: 0 }}>
            <Container header={<Header variant="h2">Construct Tree</Header>}>
              <ResourceTree tree={tree} />
            </Container>
          </div>
          <div style={RESIZE_HANDLE_STYLE} onMouseDown={startResize} role="separator" aria-orientation="vertical">
            <div style={RESIZE_GRIP_STYLE} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Grid gridDefinition={[{ colspan: 6 }, { colspan: 6 }]}>
              <FilePane title="file 1" />
              <FilePane title="file 2" />
            </Grid>
          </div>
        </div>
        <Container header={<Header variant="h2">Violations</Header>}>
          <ViolationsContent violations={violations} />
        </Container>
      </SpaceBetween>
    </ContentLayout>
  );
}

function ResourceTree({ tree }: { readonly tree?: TreeResponse }): JSX.Element {
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
  return <ViolationsPanel violations={violations.violations} reportError={violations.reportError} />;
}

const MIN_TREE_WIDTH = 220;
const MAX_TREE_WIDTH = 720;
const SPLIT_ROW_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'stretch' };
const RESIZE_HANDLE_STYLE: React.CSSProperties = {
  flexShrink: 0,
  width: '11px',
  cursor: 'col-resize',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'stretch',
};
const RESIZE_GRIP_STYLE: React.CSSProperties = { width: '2px', background: '#d1d5db', borderRadius: '1px' };
