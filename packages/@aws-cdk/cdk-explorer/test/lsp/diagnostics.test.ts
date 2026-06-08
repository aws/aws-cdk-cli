import { pathToFileURL } from 'url';
import { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
import type { PolicyValidationReportJson } from '@aws-cdk/cloud-assembly-schema';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { ConstructNode } from '../../lib';
import { mapViolationsToDiagnostics } from '../../lib/lsp/diagnostics';

const nodeWithLocation = (path: string, file: string, line: number, column: number): ConstructNode => ({
  path,
  id: path.split('/').pop() ?? path,
  children: [],
  sourceLocation: { file, line, column },
});

const nodeNoLocation = (path: string): ConstructNode => ({
  path,
  id: path.split('/').pop() ?? path,
  children: [],
});

const indexOf = (...nodes: ConstructNode[]): ConstructIndex => ConstructIndex.fromTree(nodes);

const reportWith = (...violations: Array<{
  ruleName: string;
  description?: string;
  severity: 'fatal' | 'error' | 'warning' | 'info' | 'custom';
  suggestedFix?: string;
  paths: string[];
}>): PolicyValidationReportJson => ({
  version: '1.0.0',
  pluginReports: [{
    pluginName: 'test-plugin',
    conclusion: 'failure',
    violations: violations.map((v) => ({
      ruleName: v.ruleName,
      description: v.description ?? v.ruleName,
      severity: v.severity,
      suggestedFix: v.suggestedFix,
      violatingConstructs: v.paths.map((p) => ({ constructPath: p })),
    })),
  }],
});

describe('mapViolationsToDiagnostics', () => {
  test('returns empty maps when violations is undefined', () => {
    const { byUri, dropped } = mapViolationsToDiagnostics(undefined, indexOf());
    expect(byUri.size).toBe(0);
    expect(dropped).toHaveLength(0);
  });

  test('emits one diagnostic per violating construct, grouped by URI', () => {
    const tree = indexOf(nodeWithLocation('S/MyBucket', '/p/lib/s.ts', 12, 5));
    const report = reportWith({
      ruleName: 'no-public-buckets',
      description: 'S3 must not be public',
      severity: 'error',
      paths: ['S/MyBucket'],
    });

    const { byUri, dropped } = mapViolationsToDiagnostics(report, tree);

    const expectedUri = pathToFileURL('/p/lib/s.ts').toString();
    expect(byUri.get(expectedUri)).toHaveLength(1);
    expect(dropped).toHaveLength(0);

    const diag = byUri.get(expectedUri)![0];
    expect(diag.severity).toBe(DiagnosticSeverity.Error);
    expect(diag.code).toBe('no-public-buckets');
    expect(diag.source).toBe('CDK Synth');
    // Range starts at construct creation (1-based -> 0-based) and extends
    // to LSP's end-of-line sentinel so the squiggle is visible.
    expect(diag.range).toEqual({
      start: { line: 11, character: 4 },
      end: { line: 11, character: Number.MAX_VALUE },
    });
  });

  test('groups multiple violations on the same file under one URI', () => {
    const tree = indexOf(
      nodeWithLocation('S/A', '/p/lib/s.ts', 10, 1),
      nodeWithLocation('S/B', '/p/lib/s.ts', 20, 1),
    );
    const report = reportWith(
      { ruleName: 'r1', severity: 'error', paths: ['S/A'] },
      { ruleName: 'r2', severity: 'warning', paths: ['S/B'] },
    );

    const { byUri } = mapViolationsToDiagnostics(report, tree);
    const uri = pathToFileURL('/p/lib/s.ts').toString();
    expect(byUri.get(uri)).toHaveLength(2);
  });

  test('maps severity correctly', () => {
    const tree = indexOf(
      nodeWithLocation('S/F', '/x.ts', 1, 1),
      nodeWithLocation('S/E', '/x.ts', 2, 1),
      nodeWithLocation('S/W', '/x.ts', 3, 1),
      nodeWithLocation('S/I', '/x.ts', 4, 1),
      nodeWithLocation('S/C', '/x.ts', 5, 1),
    );
    const report = reportWith(
      { ruleName: 'fatal', severity: 'fatal', paths: ['S/F'] },
      { ruleName: 'error', severity: 'error', paths: ['S/E'] },
      { ruleName: 'warning', severity: 'warning', paths: ['S/W'] },
      { ruleName: 'info', severity: 'info', paths: ['S/I'] },
      { ruleName: 'custom', severity: 'custom', paths: ['S/C'] },
    );

    const { byUri } = mapViolationsToDiagnostics(report, tree);
    const diags = byUri.get(pathToFileURL('/x.ts').toString())!;
    const byCode = new Map(diags.map((d) => [d.code, d.severity]));
    expect(byCode.get('fatal')).toBe(DiagnosticSeverity.Error);
    expect(byCode.get('error')).toBe(DiagnosticSeverity.Error);
    expect(byCode.get('warning')).toBe(DiagnosticSeverity.Warning);
    expect(byCode.get('info')).toBe(DiagnosticSeverity.Information);
    expect(byCode.get('custom')).toBe(DiagnosticSeverity.Information);
  });

  test('appends suggestedFix to the message when present', () => {
    const tree = indexOf(nodeWithLocation('S/X', '/x.ts', 1, 1));
    const report = reportWith({
      ruleName: 'r',
      description: 'do not do that',
      severity: 'error',
      suggestedFix: 'do this instead',
      paths: ['S/X'],
    });

    const { byUri } = mapViolationsToDiagnostics(report, tree);
    const diag = byUri.get(pathToFileURL('/x.ts').toString())![0];
    expect(diag.message).toContain('do not do that');
    expect(diag.message).toContain('Suggested fix: do this instead');
  });

  test('drops violations whose constructPath is unknown', () => {
    const tree = indexOf();
    const report = reportWith({ ruleName: 'r', severity: 'error', paths: ['S/Missing'] });
    const { byUri, dropped } = mapViolationsToDiagnostics(report, tree);

    expect(byUri.size).toBe(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({
      ruleName: 'r',
      constructPath: 'S/Missing',
      reason: expect.stringContaining('no tree node'),
    });
  });

  test('drops violations whose construct has no sourceLocation (non-TS app)', () => {
    const tree = indexOf(nodeNoLocation('S/MyBucket'));
    const report = reportWith({ ruleName: 'r', severity: 'error', paths: ['S/MyBucket'] });

    const { byUri, dropped } = mapViolationsToDiagnostics(report, tree);
    expect(byUri.size).toBe(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toContain('no sourceLocation');
  });

  test('drops violations whose source file is not TypeScript', () => {
    const tree = indexOf(nodeWithLocation('S/X', '/p/lib/x.py', 1, 1));
    const report = reportWith({ ruleName: 'r', severity: 'error', paths: ['S/X'] });

    const { byUri, dropped } = mapViolationsToDiagnostics(report, tree);
    expect(byUri.size).toBe(0);
    expect(dropped[0].reason).toContain('non-TypeScript');
  });
});
