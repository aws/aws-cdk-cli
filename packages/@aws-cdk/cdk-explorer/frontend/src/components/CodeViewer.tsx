import Tooltip from '@cloudscape-design/components/tooltip';
import * as awsui from '@cloudscape-design/design-tokens';
import * as React from 'react';
import { isWhitespace, tokenizeLines, type Language, type Token } from '../syntax';
import { TOKEN_COLORS } from './colors';
import { colorForSeverity } from './severities';
import { worstSeverity } from '../../../lib/web-shared/severity';
import { addToColl } from '../util';

/**
 * Diagnostics which are shown with an underline
 */
export interface Diagnostic {
  readonly startLine: number;
  readonly startCol: number;
  readonly endCol?: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message?: string;
}

/**
 * Annotations which are shown in the margin
 */
export interface Annotation {
  readonly line: number;
  readonly message?: string;
  readonly color?: string;
  readonly onClick?: () => void;
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
  readonly annotations?: readonly Annotation[];
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
  annotations,
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
    const map = new Map<number, Diagnostic[]>();
    for (const d of diagnostics ?? []) {
      addToColl(map, d.startLine, d);
    }
    return map;
  }, [diagnostics]);

  const annotationsByLine = React.useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const a of annotations ?? []) {
      addToColl(map, a.line, a);
    }
    return map;
  }, [annotations]);

  return (
    <div style={CONTAINER_STYLE}>
      {tokenizedLines.map((lineTokens, i) => {
        const lineNum = i + 1;
        const isHighlighted = highlightStart !== undefined
          && highlightEnd !== undefined
          && lineNum >= highlightStart
          && lineNum <= highlightEnd;
        const isScrollTarget = lineNum === scrollToLine;
        const lineDiagnostics = diagnosticsByLine.get(lineNum) ?? [];
        const lineAnnotations = annotationsByLine.get(lineNum) ?? [];

        return (
          <div
            key={`${lineNum}`}
            ref={(el) => {
              if (isScrollTarget && el) {
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              }
            }}
            className={isHighlighted ? 'nav-highlight' : undefined}
            style={{
              ...LINE_STYLE,
              ...(isHighlighted ? { ['--nav-highlight-color']: highlightColor ?? awsui.colorChartsBlue1500 } : undefined),
            }}
            onDoubleClick={onLineDoubleClick ? () => onLineDoubleClick(lineNum) : undefined}
          >
            <span style={{ ...LINE_NUM_STYLE, width: gutterWidth }}>{lineNum}</span>
            {lineAnnotations.length > 0 && <span style={{ position: 'absolute' }}>ANN</span>}
            <span style={LINE_CONTENT_STYLE}>
              {lineDiagnostics.length > 0
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
  const worst = worstSeverity(diagnostics.map(d => d.severity));
  const color = colorForSeverity(worst);

  // Skip leading whitespace, then inject the underline span for the rest of the line.
  let textStart = 0;
  while (textStart < tokens.length && isWhitespace(tokens[textStart])) {
    textStart++;
  }
  if (textStart === tokens.length) {
    textStart = 0;
  }

  // Group by description to avoid repeating the same message multiple times in the tooltip.
  const grouped: Record<string, Diagnostic[]> = {};
  for (const diagnostic of diagnostics) {
    if (!grouped[diagnostic.message]) {
      grouped[diagnostic.message] = [];
    }
    grouped[diagnostic.message].push(diagnostic);
  }

  return <>
    {renderTokens(tokens.slice(0, textStart))}
    <WavyUnderline color={color} content={
      <div className="make-me-big">
        {Object.keys(grouped).map((message, i) => <div key={i}>{message}</div>)}
      </div>
    }>
      {renderTokens(tokens.slice(textStart))}
    </WavyUnderline>
  </>;
}

const CONTAINER_STYLE: React.CSSProperties = {
  margin: 0,
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

interface WavyUnderlineProps {
  color: string;
  children: React.ReactNode;
  content: React.ReactNode;
}

function WavyUnderline(props: WavyUnderlineProps) {
  const wrapperRef = React.useRef<HTMLSpanElement>(null);
  const [showTooltip, setShowTooltip] = React.useState(false);

  return <span
    ref={wrapperRef}
    style={{ textDecoration: `underline wavy ${props.color}`, textUnderlineOffset: '3px' }}
    tabIndex={0}
    role="group"
    onPointerEnter={() => setShowTooltip(true)}
    onPointerLeave={() => setShowTooltip(false)}
    onFocus={() => setShowTooltip(true)}
    onBlur={() => setShowTooltip(false)}
  >
    {props.children}
    {showTooltip && (
      <Tooltip
        content={props.content}
        getTrack={() => wrapperRef.current}
        onEscape={() => setShowTooltip(false)}
      />
    )}
  </span>;
}
