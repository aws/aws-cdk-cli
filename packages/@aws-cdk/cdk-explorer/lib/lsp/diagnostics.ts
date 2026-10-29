import type {
  PluginReportJson,
  PolicyViolationJson,
  PolicyViolationSeverity,
  ViolatingConstructJson,
} from '@aws-cdk/cloud-assembly-schema';
import {
  type Diagnostic,
  DiagnosticSeverity,
  type Range,
} from 'vscode-languageserver/node';
import { groupBy } from './codelens';
import type { AssemblyIndexWithSourceLocations } from '../core/assembly-index-with-source-locations';
import { pathToFileURL } from '../core/safe-url';

// Range end character: max valid LSP uinteger (2^31-1); clients clamp it to the
// line length. Not Number.MAX_VALUE, which VS Code tolerates but IntelliJ's
// lsp4j rejects as out-of-range, silently dropping the diagnostic.
const END_OF_LINE_CHARACTER = 2_147_483_647;

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
 * Violations we can't anchor to a source location are dropped
 * (with a reason) rather than thrown.
 */
export function mapViolationsToDiagnostics(
  violations: PluginReportJson[] | undefined,
  index: AssemblyIndexWithSourceLocations,
): MapViolationsResult {
  const dropped: Array<MapViolationsResult['dropped'][number]> = [];
  const located: Array<{ uri: string; diagnostic: Diagnostic }> = [];

  for (const { pluginName, violatedRule, constructPath, violation } of flattenTargets(violations)) {
    const anchored = anchorViolation(violation, index);
    if (isFailure(anchored)) {
      dropped.push({ ruleName: violatedRule.ruleName, constructPath: constructPath ?? '', reason: anchored.reason });
    } else {
      located.push(...anchored.map((a) => ({ uri: a.uri, diagnostic: buildDiagnostic(violatedRule, a.range, pluginName) })));
    }
  }

  const byUri = new Map<string, Diagnostic[]>(
    [...groupBy(located, (l) => l.uri)].map(([uri, items]) => [uri, dedupeDiagnostics(items.map((i) => i.diagnostic))]),
  );
  return { byUri, dropped };
}

interface ViolationTarget {
  readonly pluginName: string;
  readonly violatedRule: PolicyViolationJson;
  readonly constructPath: string | undefined;
  readonly violation: ViolatingConstructJson;
}

/** Flatten the report's plugin -> violation -> target nesting into a flat list. */
function flattenTargets(reports: PluginReportJson[] | undefined): ViolationTarget[] {
  return (reports ?? []).flatMap((plugin) =>
    (plugin.violations ?? []).flatMap((violation) =>
      (violation.violatingConstructs ?? []).map((target) => ({
        pluginName: plugin.pluginName,
        violatedRule: violation,
        constructPath: target.constructPath,
        violation: target,
      }))));
}

/** Resolve a violation to a presentable anchor, or a reason it can't be shown. */
function anchorViolation(
  violation: ViolatingConstructJson,
  index: AssemblyIndexWithSourceLocations,
): Result<{ readonly uri: string; readonly range: Range }[]> {
  const traced = index.traceViolation(violation);
  return traced.sourceLocations.map((loc) => {
    return { uri: pathToFileURL(index.appDir.absolute(loc.file)).toString(), range: toRange(loc) };
  });
}

function dedupeDiagnostics(xs: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];
  for (const diag of xs) {
    const key = `${diag.range.start.line}:${diag.range.start.character}:${diag.code}:${diag.source}:${diag.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(diag);
    }
  }
  return result;
}

/**
 * LSP range for a source location. Anchors at the resolved line/column, or the
 * top of the file when line/column aren't known. LSP positions are 0-based;
 * sourceLocation is 1-based. The end spans the rest of the line.
 */
function toRange(loc: { line: number }): Range {
  const hasLineCol = loc.line >= 1;
  const line = hasLineCol ? loc.line - 1 : 0;
  return { start: { line, character: 0 }, end: { line, character: END_OF_LINE_CHARACTER } };
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

type Result<A> = A | { readonly reason: string };

function isFailure<A>(result: Result<A>): result is Extract<Result<A>, { readonly reason: string }> {
  return result && typeof result === 'object' && 'reason' in (result as any);
}
