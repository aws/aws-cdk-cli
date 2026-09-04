import { pathToFileURL } from 'url';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { SynthRunResult } from '../../lib/core/synth-runner';
import { parseSynthErrors, synthFailureDiagnostics } from '../../lib/lsp/synth-diagnostics';

describe('parseSynthErrors', () => {
  test('parses multiple ts-node (pretty) errors', () => {
    const locs = parseSynthErrors(
      'lib/stack.ts:12:5 - error TS2322: Type A.\nlib/stack.ts:20:9 - error TS2554: Type B.\n',
    );
    expect(locs).toEqual([
      { file: 'lib/stack.ts', line: 12, column: 5, message: 'error TS2322: Type A.' },
      { file: 'lib/stack.ts', line: 20, column: 9, message: 'error TS2554: Type B.' },
    ]);
  });

  test('parses multiple tsc-format errors (ts-node default)', () => {
    const locs = parseSynthErrors(
      'lib/stack.ts(1,7): error TS2322: x\nbin/app.ts(3,1): error TS1005: y\n',
    );
    expect(locs).toEqual([
      { file: 'lib/stack.ts', line: 1, column: 7, message: 'error TS2322: x' },
      { file: 'bin/app.ts', line: 3, column: 1, message: 'error TS1005: y' },
    ]);
  });

  test('returns empty when nothing matches', () => {
    expect(parseSynthErrors('unrelated output')).toEqual([]);
    expect(parseSynthErrors(undefined)).toEqual([]);
  });
});

describe('synthFailureDiagnostics', () => {
  test('groups multiple errors in the same file into one entry', () => {
    const result: SynthRunResult = {
      status: 'app-failure',
      message: 'summary',
      details: 'lib/stack.ts(1,7): error TS2322: a\nlib/stack.ts(2,3): error TS1005: b',
    };

    const out = synthFailureDiagnostics(result, '/p');

    expect(out).toHaveLength(1);
    expect(out[0].uri).toBe(pathToFileURL('/p/lib/stack.ts').toString());
    expect(out[0].diagnostics).toHaveLength(2);
    expect(out[0].diagnostics[0]).toEqual({
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: Number.MAX_VALUE } },
      severity: DiagnosticSeverity.Error,
      source: 'cdk synth',
      message: 'error TS2322: a',
    });
  });

  test('produces one entry per file', () => {
    const result: SynthRunResult = {
      status: 'app-failure',
      message: 'summary',
      details: 'lib/stack.ts(1,1): error TS1: a\nbin/app.ts(2,2): error TS2: b',
    };

    const uris = synthFailureDiagnostics(result, '/p').map((o) => o.uri).sort();

    expect(uris).toEqual([
      pathToFileURL('/p/bin/app.ts').toString(),
      pathToFileURL('/p/lib/stack.ts').toString(),
    ].sort());
  });

  test('falls back to cdk.json when nothing parses', () => {
    const out = synthFailureDiagnostics({ status: 'app-failure', message: 'context needed' }, '/p');
    expect(out).toHaveLength(1);
    expect(out[0].uri).toBe(pathToFileURL('/p/cdk.json').toString());
    expect(out[0].diagnostics[0].message).toBe('context needed');
  });

  test('ignores errors outside the project (falls back to cdk.json)', () => {
    const out = synthFailureDiagnostics(
      { status: 'app-failure', message: 'summary', details: '../evil.ts(1,1): error TS1: x' },
      '/p',
    );
    expect(out).toHaveLength(1);
    expect(out[0].uri).toBe(pathToFileURL('/p/cdk.json').toString());
  });

  test('returns empty for non-app-failure outcomes', () => {
    expect(synthFailureDiagnostics({ status: 'success' }, '/p')).toEqual([]);
    expect(synthFailureDiagnostics({ status: 'lock-conflict' }, '/p')).toEqual([]);
    expect(synthFailureDiagnostics({ status: 'error', message: 'x' }, '/p')).toEqual([]);
  });
});
