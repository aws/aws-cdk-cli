import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import * as React from 'react';
import { api, type DirEntry } from '../api';

interface FilePaneProps {
  /** Heading shown in the pane header (e.g. "file 1"). */
  readonly title: string;
}

/**
 * A self-contained code pane with a server-backed file picker. Browses
 * directories under the app root via /api/files and shows file contents via
 * /api/file. Rendered once per code pane (center and right).
 */
export function FilePane({ title }: FilePaneProps): JSX.Element {
  const [picking, setPicking] = React.useState(false);
  const [dir, setDir] = React.useState('');
  const [entries, setEntries] = React.useState<readonly DirEntry[]>([]);
  const [filePath, setFilePath] = React.useState<string | undefined>();
  const [content, setContent] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();

  const browse = React.useCallback(async (nextDir: string) => {
    try {
      const res = await api.listFiles(nextDir);
      setDir(res.dir);
      setEntries(res.entries);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const openPicker = React.useCallback(() => {
    setPicking(true);
    void browse('');
  }, [browse]);

  const choose = React.useCallback(async (entry: DirEntry) => {
    if (entry.type === 'dir') {
      void browse(entry.path);
      return;
    }
    try {
      const res = await api.readFile(entry.path);
      setFilePath(res.path);
      setContent(res.content);
      setPicking(false);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [browse]);

  return (
    <Container
      header={
        <Header variant="h2" actions={<Button iconName="folder-open" onClick={openPicker}>Open file…</Button>}>
          {filePath ?? title}
        </Header>
      }
    >
      <SpaceBetween size="s">
        {error && <Box color="text-status-error">{error}</Box>}
        {picking ? (
          <FileBrowser dir={dir} entries={entries} onChoose={choose} onUp={() => browse(parentOf(dir))} />
        ) : (
          <pre style={CODE_STYLE}>{content || 'No file selected.'}</pre>
        )}
      </SpaceBetween>
    </Container>
  );
}

const CODE_STYLE: React.CSSProperties = {
  margin: 0,
  maxHeight: '60vh',
  overflow: 'auto',
  fontFamily: 'Monaco, Menlo, "Courier New", monospace',
  fontSize: '12px',
  whiteSpace: 'pre',
};

function FileBrowser(props: {
  readonly dir: string;
  readonly entries: readonly DirEntry[];
  readonly onChoose: (entry: DirEntry) => void;
  readonly onUp: () => void;
}): JSX.Element {
  return (
    <SpaceBetween size="xxs">
      <Box variant="code">/{props.dir}</Box>
      {props.dir !== '' && <Button variant="inline-link" iconName="folder" onClick={props.onUp}>../</Button>}
      {props.entries.map((entry) => (
        <Button
          key={entry.path}
          variant="inline-link"
          iconName={entry.type === 'dir' ? 'folder' : 'file'}
          onClick={() => props.onChoose(entry)}
        >
          {entry.type === 'dir' ? `${entry.name}/` : entry.name}
        </Button>
      ))}
    </SpaceBetween>
  );
}

function parentOf(dir: string): string {
  const idx = dir.lastIndexOf('/');
  return idx === -1 ? '' : dir.slice(0, idx);
}
