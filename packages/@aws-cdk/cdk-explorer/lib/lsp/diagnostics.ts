import { pathToFileURL } from 'url';
import type { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
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
import { groupBy } from './codelens';
import type { ConstructNode } from '../core/assembly-reader';
import type { SourceLocation } from '../core/source-resolver';

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
 * Violations we can't anchor to a TypeScript source location are dropped
 * (with a reason) rather than thrown.
 */
export function mapViolationsToDiagnostics(
  violations: PolicyValidationReportJson | undefined,
  index: ConstructIndex<ConstructNode>,
): MapViolationsResult {
  const dropped: Array<MapViolationsResult['dropped'][number]> = [];
  const located: Array<{ uri: string; diagnostic: Diagnostic }> = [];

  for (const { pluginName, violation, constructPath } of flattenTargets(violations)) {
    const anchored = anchorViolation(constructPath, index);
    if ('reason' in anchored) {
      dropped.push({ ruleName: violation.ruleName, constructPath: constructPath ?? '', reason: anchored.reason });
    } else {
      located.push({ uri: anchored.uri, diagnostic: buildDiagnostic(violation, anchored.range, pluginName) });
    }
  }

  const byUri = new Map<string, Diagnostic[]>(
    [...groupBy(located, (l) => l.uri)].map(([uri, items]) => [uri, items.map((i) => i.diagnostic)]),
  );
  return { byUri, dropped };
}

interface ViolationTarget {
  readonly pluginName: string;
  readonly violation: PolicyViolationJson;
  readonly constructPath: string | undefined;
}

/** Flatten the report's plugin -> violation -> target nesting into a flat list. */
function flattenTargets(report: PolicyValidationReportJson | undefined): ViolationTarget[] {
  return (report?.pluginReports ?? []).flatMap((plugin) =>
    (plugin.violations ?? []).flatMap((violation) =>
      (violation.violatingConstructs ?? []).map((target) => ({
        pluginName: plugin.pluginName,
        violation,
        constructPath: target.constructPath,
      }))));
}

/** A construct's source location, or the reason it has none. */
function resolveLocation(
  constructPath: string | undefined,
  index: ConstructIndex<ConstructNode>,
): SourceLocation | { readonly reason: string } {
  if (!constructPath) return { reason: 'violation has no construct path' };
  const node = index.byPath(constructPath);
  if (!node) return { reason: 'not found in the construct tree' };
  if (!node.sourceLocation) return { reason: 'no source location (non-TypeScript app or framework-only trace)' };
  return node.sourceLocation;
}

/** Resolve a violation to a presentable anchor, or a reason it can't be shown. */
function anchorViolation(
  constructPath: string | undefined,
  index: ConstructIndex<ConstructNode>,
): { readonly uri: string; readonly range: Range } | { readonly reason: string } {
  const loc = resolveLocation(constructPath, index);
  if ('reason' in loc) return loc;

  // We only surface diagnostics for TypeScript sources for now.
  if (!isTypeScript(loc.file)) return { reason: `source file is not TypeScript: ${loc.file}` };

  return { uri: pathToFileURL(loc.file).toString(), range: toRange(loc) };
}

function isTypeScript(file: string): boolean {
  return file.endsWith('.ts') || file.endsWith('.tsx');
}

/**
 * LSP range for a source location. Anchors at the resolved line/column, or at
 * the top of the file when the file is known but the line/column aren't. LSP
 * positions are 0-based; sourceLocation is 1-based. The end spans to
 * Number.MAX_VALUE so the squiggle covers the rest of the line.
 */
function toRange(loc: SourceLocation): Range {
  const hasLineCol = loc.line >= 1 && loc.column >= 1;
  const line = hasLineCol ? loc.line - 1 : 0;
  const character = hasLineCol ? loc.column - 1 : 0;
  return { start: { line, character }, end: { line, character: Number.MAX_VALUE } };
}

function buildDiagnostic(violation: PolicyViolationJson, range: Range, pluginName: string): Diagnostic {
  return {
    range,
    severity: severityFor(violation.severity),
    code: violation.ruleName,
    source: pluginName,
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
