import { isNode, isScalar, isMap, LineCounter, parseDocument, stringify } from 'yaml';
import * as React from 'react';
import type { TemplateResource, WebViolation } from '../api';
import { CodeViewer, type Diagnostic } from './CodeViewer';

export interface TemplateViewerProps {
  readonly jsonContent: string;
  readonly resources: Record<string, TemplateResource>;
  readonly highlightLogicalId?: string;
  readonly highlightColor?: string;
  readonly navCounter?: number;
  readonly onResourceDoubleClick?: (logicalId: string) => void;
  readonly templateFile?: string;
  readonly violations?: readonly WebViolation[];
  readonly format: Format;
}

export type Format = 'yaml' | 'json';

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
  templateFile,
  violations,
  format,
}: TemplateViewerProps): JSX.Element {

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

  const diagnostics = React.useMemo(() => {
    if (!templateFile || !violations?.length) return undefined;
    const lines = displayContent.split('\n');
    const diags: Diagnostic[] = [];
    for (const violation of violations) {
      const severity = violationSeverity(violation.severity);
      for (const occ of violation.occurrences) {
        if (occ.templateFile === templateFile && occ.logicalId) {
          const resource = displayResources[occ.logicalId];
          if (resource) {
            const line = lines[resource.block.startLine - 1];
            const startCol = line ? line.search(/\S/) + 1 : 1;
            diags.push({ startLine: resource.block.startLine, startCol: Math.max(1, startCol), severity, message: violation.description });
          }
        }
      }
    }
    return diags.length > 0 ? diags : undefined;
  }, [templateFile, violations, displayResources, displayContent]);

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
    <CodeViewer
      content={displayContent}
      language={format}
      highlightStart={highlight?.start}
      highlightEnd={highlight?.end}
      highlightColor={highlightColor}
      navCounter={navCounter}
      scrollToLine={highlight?.start}
      onLineDoubleClick={handleDoubleClick}
      diagnostics={diagnostics}
    />
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


function violationSeverity(severity: string | undefined): 'error' | 'warning' | 'info' {
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
