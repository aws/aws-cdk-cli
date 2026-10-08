import * as React from 'react';
import { tokenizeLines, type Language, type Token } from '../syntax';
import { colorForSeverity } from './severities';
import { TOKEN_COLORS } from './colors';

export interface Diagnostic {
  readonly startLine: number;
  readonly startCol: number;
  readonly endCol?: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message?: string;
}

export interface CodeViewerProps {
  readonly content: string;
  readonly language: Language;
  readonly highlightStart?: number;
  readonly highlightEnd?: number;
  readonly highlightColor?: string;
  readonly scrollToLine?: number;
  readonly onLineDoubleClick?: (line: number) => void;
  readonly diagnostics?: readonly Diagnostic[];
}

export function CodeViewer({
  content,
  language,
  highlightStart,
  highlightEnd,
  highlightColor,
  scrollToLine,
  onLineDoubleClick,
  diagnostics,
}: CodeViewerProps): JSX.Element {
  const tokenizedLines = React.useMemo(
    () => tokenizeLines(content, language),
    [content, language],
  );

  const gutterWidth = React.useMemo(() => {
    const digits = String(tokenizedLines.length).length;
    return `${digits * 8 + 8}px`;
  }, [tokenizedLines.length]);

  const diagnosticsByLine = React.useMemo(() => {
    if (!diagnostics?.length) return undefined;
    const map = new Map<number, Diagnostic[]>();
    for (const d of diagnostics) {
      const arr = map.get(d.startLine) ?? [];
      arr.push(d);
      map.set(d.startLine, arr);
    }
    return map;
  }, [diagnostics]);

  return (
    <div style={CONTAINER_STYLE}>
      {tokenizedLines.map((lineTokens, i) => {
        const lineNum = i + 1;
        const isHighlighted = highlightStart !== undefined
          && highlightEnd !== undefined
          && lineNum >= highlightStart
          && lineNum <= highlightEnd;
        const isScrollTarget = lineNum === scrollToLine;
        const lineDiagnostics = diagnosticsByLine?.get(lineNum);

        return (
          <div
            key={`${lineNum}`}
            ref={(el) => {
              if (isScrollTarget && el) {
                el.scrollIntoView({ block: 'start', behavior: 'smooth' });
              }
            }}
            className={isHighlighted ? 'nav-highlight' : undefined}
            style={{
              ...LINE_STYLE,
              ...(isHighlighted ? { ['--nav-highlight-color' as string]: highlightColor ?? '#0972d3' } : undefined),
            }}
            onDoubleClick={onLineDoubleClick ? () => onLineDoubleClick(lineNum) : undefined}
          >
            <span style={{ ...LINE_NUM_STYLE, width: gutterWidth }}>{lineNum}</span>
            <span style={LINE_CONTENT_STYLE}>
              {lineDiagnostics
                ? renderWithDiagnostics(lineTokens, lineDiagnostics)
                : renderTokens(lineTokens)
              }
            </span>
          </div>
        );
      })}
    </div>
  );
}

function renderTokens(tokens: Token[]): React.ReactNode {
  return tokens.map((token, j) => {
    const color = token.type ? TOKEN_COLORS[token.type] : undefined;
    return color
      ? <span key={j} style={{ color }}>{token.content}</span>
      : <span key={j}>{token.content}</span>;
  });
}

function renderWithDiagnostics(tokens: Token[], diagnostics: Diagnostic[]): React.ReactNode {
  let col = 1;
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const token of tokens) {
    const tokenStart = col;
    const tokenEnd = col + token.content.length;
    const color = token.type ? TOKEN_COLORS[token.type] : undefined;

    let hasOverlap = false;
    for (const d of diagnostics) {
      const dEnd = d.endCol ?? 999;
      if (d.startCol < tokenEnd && dEnd > tokenStart) {
        hasOverlap = true;
        break;
      }
    }

    if (!hasOverlap) {
      elements.push(
        color
          ? <span key={key++} style={{ color }}>{token.content}</span>
          : <span key={key++}>{token.content}</span>,
      );
    } else {
      const chars = token.content;
      let segStart = 0;
      let currentSeverity = '';

      for (let c = 0; c <= chars.length; c++) {
        const charCol = tokenStart + c;
        let severity = '';
        for (const d of diagnostics) {
          const dEnd = d.endCol ?? 999;
          if (charCol >= d.startCol && charCol < dEnd) {
            severity = d.severity;
            break;
          }
        }

        if (c === chars.length || severity !== currentSeverity) {
          if (segStart < c) {
            const text = chars.slice(segStart, c);
            if (currentSeverity) {
              elements.push(
                <span key={key++} style={{ color, textDecoration: `underline wavy ${colorForSeverity(currentSeverity)}`, textUnderlineOffset: '3px' }}>
                  {text}
                </span>,
              );
            } else {
              elements.push(
                color
                  ? <span key={key++} style={{ color }}>{text}</span>
                  : <span key={key++}>{text}</span>,
              );
            }
          }
          segStart = c;
          currentSeverity = severity;
        }
      }
    }

    col = tokenEnd;
  }

  return elements;
}

const CONTAINER_STYLE: React.CSSProperties = {
  margin: 0,
  maxHeight: '100%',
//  overflowX: 'auto',
//  overflowY: 'auto',
  fontFamily: 'Monaco, Menlo, "Courier New", monospace',
  fontSize: '12px',
  lineHeight: '18px',
  whiteSpace: 'pre',
};

const LINE_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minHeight: '18px',
  position: 'relative',
};

const LINE_NUM_STYLE: React.CSSProperties = {
  flexShrink: 0,
  textAlign: 'right',
  paddingRight: '8px',
  color: '#9ba7b6',
  userSelect: 'none',
};

const LINE_CONTENT_STYLE: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
};
