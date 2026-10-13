import { pathToFileURL } from 'url';
import type { PluginReportJson, PolicyViolationSeverity } from '@aws-cdk/cloud-assembly-schema';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { mapViolationsToDiagnostics } from '../../lib/lsp/diagnostics';
import { AssemblyFixture } from '../_helpers/assembly';

let fixture: AssemblyFixture | undefined;

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

interface ViolationSpec {
  readonly ruleName: string;
  readonly description?: string;
  readonly severity: PolicyViolationSeverity;
  readonly suggestedFix?: string;
  readonly paths: string[];
}

function reportWith(...violations: ViolationSpec[]): PluginReportJson[] {
  return [{
    pluginName: 'test-plugin',
    conclusion: 'failure',
    violations: violations.map((v) => ({
      ruleName: v.ruleName,
      description: v.description ?? v.ruleName,
      severity: v.severity,
      suggestedFix: v.suggestedFix,
      violatingConstructs: v.paths.map((p) => ({ constructPath: p })),
    })),
  }];
}

/** URI the diagnostics should be published under for an app-relative source file. */
function uriFor(relPath: string): string {
  return pathToFileURL(fixture!.sourcePath(relPath)).toString();
}

describe('mapViolationsToDiagnostics', () => {
  test('returns empty maps when there is no report', async () => {
    fixture = AssemblyFixture.create();

    const { byUri, dropped } = mapViolationsToDiagnostics(undefined, await fixture.index());

    expect(byUri.size).toBe(0);
    expect(dropped).toHaveLength(0);
  });

  test('anchors a diagnostic at the construct creation site, spanning to end of line', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: { 'lib/s.ts': '\n'.repeat(20) },
      stacks: [{ id: 'S', resources: [{ path: 'MyBucket/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/s.ts:12:5' }] }],
    });

    const { byUri, dropped } = mapViolationsToDiagnostics(
      reportWith({ ruleName: 'no-public-buckets', description: 'S3 must not be public', severity: 'error', paths: ['S/MyBucket/Resource'] }),
      await fixture.index(),
    );

    expect(dropped).toHaveLength(0);
    const diagnostics = byUri.get(uriFor('lib/s.ts'))!;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: DiagnosticSeverity.Error,
      code: 'no-public-buckets',
      source: 'test-plugin',
    });
    // 1-based source location to 0-based LSP, then out to the end-of-line
    // sentinel so the squiggle is visible.
    expect(diagnostics[0].range).toEqual({
      start: { line: 11, character: 4 },
      end: { line: 11, character: 2147483647 },
    });
  });

  test('publishes under a URI inside the app dir, not relative to the process cwd', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: { 'lib/s.ts': '\n'.repeat(20) },
      stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/s.ts:3:1' }] }],
    });

    const { byUri } = mapViolationsToDiagnostics(
      reportWith({ ruleName: 'r', severity: 'error', paths: ['S/B/Resource'] }),
      await fixture.index(),
    );

    const [uri] = [...byUri.keys()];
    expect(uri).toBe(uriFor('lib/s.ts'));
    expect(uri).toContain(fixture.appDir);
  });

  test('groups diagnostics from the same file under one URI', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: { 'lib/s.ts': '\n'.repeat(30) },
      stacks: [{
        id: 'S',
        resources: [
          { path: 'A/Resource', logicalId: 'A1', type: 'AWS::S3::Bucket', at: 'lib/s.ts:10:1' },
          { path: 'B/Resource', logicalId: 'B1', type: 'AWS::SQS::Queue', at: 'lib/s.ts:20:1' },
        ],
      }],
    });

    const { byUri } = mapViolationsToDiagnostics(
      reportWith(
        { ruleName: 'r1', severity: 'error', paths: ['S/A/Resource'] },
        { ruleName: 'r2', severity: 'warning', paths: ['S/B/Resource'] },
      ),
      await fixture.index(),
    );

    expect(byUri.size).toBe(1);
    expect(byUri.get(uriFor('lib/s.ts'))).toHaveLength(2);
  });

  test('splits diagnostics across the files their constructs come from', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: { 'lib/a.ts': '\n'.repeat(10), 'lib/b.ts': '\n'.repeat(10) },
      stacks: [{
        id: 'S',
        resources: [
          { path: 'A/Resource', logicalId: 'A1', type: 'AWS::S3::Bucket', at: 'lib/a.ts:2:1' },
          { path: 'B/Resource', logicalId: 'B1', type: 'AWS::SQS::Queue', at: 'lib/b.ts:4:1' },
        ],
      }],
    });

    const { byUri } = mapViolationsToDiagnostics(
      reportWith({ ruleName: 'r', severity: 'error', paths: ['S/A/Resource', 'S/B/Resource'] }),
      await fixture.index(),
    );

    expect([...byUri.keys()].sort()).toEqual([uriFor('lib/a.ts'), uriFor('lib/b.ts')].sort());
  });

  test.each<[PolicyViolationSeverity, DiagnosticSeverity]>([
    ['fatal', DiagnosticSeverity.Error],
    ['error', DiagnosticSeverity.Error],
    ['warning', DiagnosticSeverity.Warning],
    ['info', DiagnosticSeverity.Information],
    ['custom', DiagnosticSeverity.Information],
  ])('maps %s severity to the LSP level', async (severity, expected) => {
    fixture = AssemblyFixture.create({
      sourceFiles: { 'lib/s.ts': '\n'.repeat(5) },
      stacks: [{ id: 'S', resources: [{ path: 'X/Resource', logicalId: 'X1', type: 'AWS::S3::Bucket', at: 'lib/s.ts:1:1' }] }],
    });

    const { byUri } = mapViolationsToDiagnostics(
      reportWith({ ruleName: 'r', severity, paths: ['S/X/Resource'] }),
      await fixture.index(),
    );

    expect([...byUri.values()][0][0].severity).toBe(expected);
  });

  test('appends the suggested fix to the message', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: { 'lib/s.ts': '\n'.repeat(5) },
      stacks: [{ id: 'S', resources: [{ path: 'X/Resource', logicalId: 'X1', type: 'AWS::S3::Bucket', at: 'lib/s.ts:1:1' }] }],
    });

    const { byUri } = mapViolationsToDiagnostics(
      reportWith({ ruleName: 'r', description: 'do not do that', severity: 'error', suggestedFix: 'do this instead', paths: ['S/X/Resource'] }),
      await fixture.index(),
    );

    const message = [...byUri.values()][0][0].message;
    expect(message).toContain('do not do that');
    expect(message).toContain('Suggested fix: do this instead');
  });

  test('anchors at the top of the file when no line or column is known', async () => {
    // A frame with a file but no line (some jsii host languages).
    fixture = AssemblyFixture.create({
      sourceFiles: { 'lib/s.ts': '\n'.repeat(5) },
      stacks: [{ id: 'S', resources: [{ path: 'X/Resource', logicalId: 'X1', type: 'AWS::S3::Bucket' }] }],
    });
    const index = await fixture.index();

    const { byUri } = mapViolationsToDiagnostics(
      [{
        pluginName: 'p',
        conclusion: 'failure',
        violations: [{
          ruleName: 'r',
          description: 'd',
          severity: 'error',
          violatingConstructs: [{
            constructPath: 'S/X/Resource',
            stackTraces: [`...aws-cdk-lib...\n<module> (${fixture.sourcePath('lib/s.ts')})`],
          }],
        }],
      }],
      index,
    );

    expect([...byUri.values()][0][0].range.start).toEqual({ line: 0, character: 0 });
  });

  test('anchors a violation in a non-TypeScript source file', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: { 'stacks/x.py': '\n'.repeat(40) },
      stacks: [{ id: 'S', resources: [{ path: 'X/Resource', logicalId: 'X1', type: 'AWS::S3::Bucket', at: 'stacks/x.py:31:1' }] }],
    });

    const { byUri, dropped } = mapViolationsToDiagnostics(
      reportWith({ ruleName: 'r', severity: 'error', paths: ['S/X/Resource'] }),
      await fixture.index(),
    );

    expect(dropped).toHaveLength(0);
    const [uri, diagnostics] = [...byUri.entries()][0];
    expect(uri).toContain('x.py');
    expect(diagnostics[0].range.start).toEqual({ line: 30, character: 0 });
  });

  test('yields no diagnostic for a construct absent from the index', async () => {
    fixture = AssemblyFixture.create();

    const { byUri, dropped } = mapViolationsToDiagnostics(
      reportWith({ ruleName: 'r', severity: 'error', paths: ['S/Missing'] }),
      await fixture.index(),
    );

    expect(byUri.size).toBe(0);
    // Unanchorable violations are skipped silently; `dropped` is only populated
    // by an explicit anchoring failure, which the current anchor path never returns.
    expect(dropped).toHaveLength(0);
  });

  test('yields no diagnostic for a construct with no creation stack', async () => {
    // Non-TypeScript app with no creation stacks recorded: nothing to anchor to.
    fixture = AssemblyFixture.create({
      stacks: [{ id: 'S', resources: [{ path: 'MyBucket/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket' }] }],
    });

    const { byUri } = mapViolationsToDiagnostics(
      reportWith({ ruleName: 'r', severity: 'error', paths: ['S/MyBucket/Resource'] }),
      await fixture.index(),
    );

    expect(byUri.size).toBe(0);
  });
});
