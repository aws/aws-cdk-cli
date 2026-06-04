import { pathToFileURL } from 'url';
import type {
  PolicyValidationReportJson,
  PolicyViolationJson,
  PolicyViolationSeverity,
} from '@aws-cdk/cloud-assembly-schema';
import {
  type Diagnostic,
  DiagnosticSeverity,
  type Range,
} from 'vscode-languageserver/node';
import type { ConstructNode } from '../core/assembly-reader';

export interface MapViolationsResult {
  /** One entry per file URI, ready for connection.sendDiagnostics. */
  readonly byUri: Map<string, Diagnostic[]>;
  /** Violations we couldn't anchor to a source location, with reason. */
  readonly dropped: ReadonlyArray<{
    readonly ruleName: string;
    readonly constructPath: string;
    readonly reason: string;
  }>;
}

/**
 * Convert a validation report into LSP diagnostics keyed by file URI.
 * Violations whose construct path is unknown, has no source location, or
 * points outside TypeScript are dropped (with a reason) rather than thrown.
 */
export function mapViolationsToDiagnostics(
  violations: PolicyValidationReportJson | undefined,
  nodesByPath: Map<string, ConstructNode>,
): MapViolationsResult {
  const byUri = new Map<string, Diagnostic[]>();
  const dropped: Array<MapViolationsResult['dropped'][number]> = [];

  if (!violations) return { byUri, dropped };

  for (const plugin of violations.pluginReports ?? []) {
    for (const violation of plugin.violations ?? []) {
      for (const target of violation.violatingConstructs ?? []) {
        const anchored = anchor(target.constructPath, nodesByPath);
        if ('error' in anchored) {
          dropped.push({
            ruleName: violation.ruleName,
            constructPath: target.constructPath ?? '',
            reason: anchored.error,
          });
          continue;
        }
        appendTo(byUri, anchored.uri, buildDiagnostic(violation, anchored.range));
      }
    }
  }

  return { byUri, dropped };
}

interface ResolvedAnchor {
  readonly uri: string;
  readonly range: Range;
}

function anchor(
  constructPath: string | undefined,
  nodesByPath: Map<string, ConstructNode>,
): ResolvedAnchor | { readonly error: string } {
  if (!constructPath) return { error: 'empty constructPath' };

  const node = nodesByPath.get(constructPath);
  if (!node) return { error: 'no tree node for constructPath' };

  const loc = node.sourceLocation;
  if (!loc) return { error: 'node has no sourceLocation (non-TS or framework-only trace)' };

  if (!loc.file.endsWith('.ts') && !loc.file.endsWith('.tsx')) {
    return { error: `non-TypeScript source: ${loc.file}` };
  }
  if (loc.line < 1 || loc.column < 1) {
    return { error: `invalid line/column: ${loc.line}:${loc.column}` };
  }

  // LSP positions are 0-based; sourceLocation is 1-based.
  // Span to end-of-line so the squiggle is visible. The LSP spec defines
  // Number.MAX_VALUE as the canonical end-of-line sentinel (vscode-
  // languageserver-types' Position.create normalizes it to uinteger.MAX_VALUE),
  // and conformant clients clamp character values past line length.
  const line = loc.line - 1;
  const character = loc.column - 1;
  return {
    uri: pathToFileURL(loc.file).toString(),
    range: { start: { line, character }, end: { line, character: Number.MAX_VALUE } },
  };
}

function buildDiagnostic(violation: PolicyViolationJson, range: Range): Diagnostic {
  return {
    range,
    severity: severityFor(violation.severity),
    code: violation.ruleName,
    source: 'CDK Synth',
    message: formatMessage(violation),
  };
}

function severityFor(s: PolicyViolationSeverity | undefined): DiagnosticSeverity {
  switch (s) {
    case 'fatal':
    case 'error':
      return DiagnosticSeverity.Error;
    case 'warning':
      return DiagnosticSeverity.Warning;
    case 'info':
    case 'custom':
    default:
      return DiagnosticSeverity.Information;
  }
}

function formatMessage(v: PolicyViolationJson): string {
  const head = v.description ?? v.ruleName;
  return v.suggestedFix ? `${head}\n\nSuggested fix: ${v.suggestedFix}` : head;
}

function appendTo(map: Map<string, Diagnostic[]>, uri: string, diag: Diagnostic): void {
  const existing = map.get(uri);
  if (existing) existing.push(diag);
  else map.set(uri, [diag]);
}
