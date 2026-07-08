import { isNode, isScalar, isMap, LineCounter, parseDocument, stringify } from 'yaml';
import * as React from 'react';
import type { TemplateResource } from '../api';
import { CodeViewer } from './CodeViewer';

export interface TemplateViewerProps {
  readonly jsonContent: string;
  readonly resources: Record<string, TemplateResource>;
  readonly highlightLogicalId?: string;
  readonly highlightColor?: string;
  readonly navCounter?: number;
  readonly onResourceDoubleClick?: (logicalId: string) => void;
}

type Format = 'yaml' | 'json';

interface ResourceSection {
  readonly logicalId: string;
  readonly startLine: number;
  readonly endLine: number;
}

export function TemplateViewer({
  jsonContent,
  resources,
  highlightLogicalId,
  highlightColor,
  navCounter,
  onResourceDoubleClick,
}: TemplateViewerProps): JSX.Element {
  const [format, setFormat] = React.useState<Format>('yaml');

  const { displayContent, displayResources, sections } = React.useMemo(() => {
    if (format === 'json') {
      return {
        displayContent: jsonContent,
        displayResources: resources,
        sections: buildSections(resources),
      };
    }
    return jsonToYaml(jsonContent);
  }, [jsonContent, resources, format]);

  // Resolve the highlight from the rendered format's own ranges (JSON block in
  // JSON view, YAML block in YAML view), so it is always in the coordinate
  // system on screen. Derived, so toggling format re-resolves.
  const highlight = React.useMemo(() => {
    const block = highlightLogicalId ? displayResources[highlightLogicalId]?.block : undefined;
    return block ? { start: block.startLine, end: block.endLine } : undefined;
  }, [highlightLogicalId, displayResources]);

  const handleDoubleClick = React.useCallback((line: number) => {
    if (!onResourceDoubleClick) return;
    // Map the clicked line back to the resource that owns it, so the reverse
    // jump is identity-based like the forward one.
    const section = sections.find((s) => line >= s.startLine && line <= s.endLine);
    if (section) {
      onResourceDoubleClick(section.logicalId);
    }
  }, [sections, onResourceDoubleClick]);

  return (
    <div style={WRAPPER_STYLE}>
      <div style={TOOLBAR_STYLE}>
        <button
          type="button"
          style={format === 'yaml' ? TOGGLE_ACTIVE_STYLE : TOGGLE_STYLE}
          onClick={() => setFormat('yaml')}
        >YAML</button>
        <button
          type="button"
          style={format === 'json' ? TOGGLE_ACTIVE_STYLE : TOGGLE_STYLE}
          onClick={() => setFormat('json')}
        >JSON</button>
      </div>
      <CodeViewer
        content={displayContent}
        language={format}
        highlightStart={highlight?.start}
        highlightEnd={highlight?.end}
        highlightColor={highlightColor}
        navCounter={navCounter}
        scrollToLine={highlight?.start}
        onLineDoubleClick={handleDoubleClick}
      />
    </div>
  );
}

function buildSections(resources: Record<string, TemplateResource>): ResourceSection[] {
  return Object.entries(resources)
    .map(([logicalId, r]) => ({ logicalId, startLine: r.block.startLine, endLine: r.block.endLine }))
    .sort((a, b) => a.startLine - b.startLine);
}

interface YamlResult {
  displayContent: string;
  displayResources: Record<string, TemplateResource>;
  sections: ResourceSection[];
}

function jsonToYaml(jsonContent: string): YamlResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    return { displayContent: jsonContent, displayResources: {}, sections: [] };
  }

  // Render and measure with the same parser so the text and the ranges always
  // agree. lineWidth:0 disables wrapping (keeps one CFN value per line, like the
  // old serializer); aliasDuplicateObjects:false keeps CloudFormation's repeated
  // objects inline instead of emitting &anchor/*alias.
  const displayContent = stringify(parsed, { indent: 2, lineWidth: 0, aliasDuplicateObjects: false });
  const lineCounter = new LineCounter();
  const doc = parseDocument(displayContent, { lineCounter });

  const displayResources: Record<string, TemplateResource> = {};
  const resources = doc.get('Resources');
  if (isMap(resources)) {
    for (const pair of resources.items) {
      const key = pair.key;
      const value = pair.value;
      if (!isScalar(key) || !isNode(value) || key.range == null || value.range == null) {
        continue;
      }
      // range is [valueStart, valueEnd, nodeEnd]; a resource block spans from its
      // logical-id key line through the end of its value.
      const startLine = lineCounter.linePos(key.range[0]).line;
      const endLine = lineCounter.linePos(value.range[1]).line;
      displayResources[String(key.value)] = { block: { startLine, endLine } };
    }
  }

  return { displayContent, displayResources, sections: buildSections(displayResources) };
}

const WRAPPER_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
};

const TOOLBAR_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 0',
  flexShrink: 0,
};

const TOGGLE_STYLE: React.CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  background: '#fafafa',
  cursor: 'pointer',
  fontSize: '11px',
  padding: '2px 8px',
  color: '#5f6b7a',
  lineHeight: '16px',
};

const TOGGLE_ACTIVE_STYLE: React.CSSProperties = {
  ...TOGGLE_STYLE,
  background: '#0972d3',
  color: '#ffffff',
  borderColor: '#0972d3',
};
