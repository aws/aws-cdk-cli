import * as path from 'path';
import { pathToFileURL } from 'url';
import { type Diagnostic, DiagnosticSeverity, type Range } from 'vscode-languageserver/node';
import type { SynthRunResult } from '../core/synth-runner';

/** A compile error parsed from synth stderr. Line/column are 1-based. */
export interface SynthErrorLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

// ts-node "pretty": "bin/app.ts:12:5 - error TS2322: ..."
const TS_NODE_RE = /^(.+?):(\d+):(\d+) - (error TS\d+:.+)$/gm;
// tsc / ts-node default: "bin/app.ts(12,5): error TS2322: ..."
const TSC_RE = /^(.+?)\((\d+),(\d+)\): (error TS\d+:.+)$/gm;

/**
 * Find every TypeScript compile error (file:line:col) in synth stderr.
 * Returns an empty array when nothing matches (e.g. a non-TypeScript app or a
 * runtime failure).
 */
export function parseSynthErrors(stderr: string | undefined): SynthErrorLocation[] {
  if (!stderr) return [];
  const out: SynthErrorLocation[] = [];
  for (const re of [TS_NODE_RE, TSC_RE]) {
    for (const m of stderr.matchAll(re)) {
      out.push({ file: m[1], line: Number(m[2]), column: Number(m[3]), message: m[4] });
    }
  }
  return out;
}

/** A diagnostic set ready to publish, with the URI it belongs to. */
export interface SynthFailureDiagnostic {
  readonly uri: string;
  readonly diagnostics: Diagnostic[];
}

/**
 * Build diagnostics for an app-failure synth outcome: one entry per failing
 * source file, considering only files inside `projectDir`. When nothing anchors
 * there, falls back to a single diagnostic on `cdk.json` carrying the summary
 * message. Returns an empty array for any non-app-failure outcome.
 */
export function synthFailureDiagnostics(
  result: SynthRunResult,
  projectDir: string,
): SynthFailureDiagnostic[] {
  if (result.status !== 'app-failure') return [];

  const byUri = new Map<string, Diagnostic[]>();
  for (const loc of parseSynthErrors(result.details)) {
    const abs = path.isAbsolute(loc.file) ? loc.file : path.resolve(projectDir, loc.file);
    if (!isWithin(projectDir, abs)) continue; // never point diagnostics outside the project
    const uri = pathToFileURL(abs).toString();
    const list = byUri.get(uri) ?? [];
    list.push(diagnostic(rangeAt(loc.line, loc.column), loc.message));
    byUri.set(uri, list);
  }

  if (byUri.size > 0) {
    return [...byUri].map(([uri, diagnostics]) => ({ uri, diagnostics }));
  }

  return [{
    uri: pathToFileURL(path.join(projectDir, 'cdk.json')).toString(),
    diagnostics: [diagnostic(rangeAt(1, 1), result.message)],
  }];
}

function diagnostic(range: Range, message: string): Diagnostic {
  return { range, severity: DiagnosticSeverity.Error, source: 'cdk synth', message };
}

/** LSP positions are 0-based; the parsed line/column are 1-based. */
function rangeAt(line: number, column: number): Range {
  const l = Math.max(0, line - 1);
  const c = Math.max(0, column - 1);
  return { start: { line: l, character: c }, end: { line: l, character: Number.MAX_VALUE } };
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}
