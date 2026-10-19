import type { PluginReportJson } from '@aws-cdk/cloud-assembly-schema';
import { CloudAssembly, loadUnifiedValidationReport } from '../../lib';
import { rimraf, writeFiles } from '../util';

const ANNOTATIONS = 'Construct Annotations';

let dir: string | undefined;

afterEach(() => {
  if (dir) rimraf(dir);
  dir = undefined;
});

/** Metadata entries that surface as stack `messages` (i.e. construct annotations). */
type Annotation = { level: 'warning' | 'error' | 'info'; path: string; message: string };

function annotationMetadata(annotations: Annotation[]): Record<string, unknown[]> {
  const metadata: Record<string, unknown[]> = {};
  for (const { level, path: constructPath, message } of annotations) {
    metadata[constructPath] ??= [];
    metadata[constructPath].push({ type: `aws:cdk:${level}`, data: message });
  }
  return metadata;
}

/**
 * An assembly with the given stacks (each optionally carrying annotations) and
 * an optional `validation-report.json`.
 */
function assemblyWith(opts: {
  stacks: Array<{ id: string; annotations?: Annotation[] }>;
  report?: { version: string; pluginReports: PluginReportJson[] };
}): string {
  const artifacts: Record<string, unknown> = {};
  const templates: Record<string, unknown> = {};

  for (const { id, annotations } of opts.stacks) {
    artifacts[id] = {
      type: 'aws:cloudformation:stack',
      environment: 'aws://111/us-east-1',
      properties: { templateFile: `${id}.template.json` },
      displayName: id,
      metadata: annotationMetadata(annotations ?? []),
    };
    templates[`${id}.template.json`] = { Resources: {} };
  }

  return writeFiles({
    'manifest.json': { version: '0.0.0', artifacts },
    ...templates,
    ...(opts.report ? { 'validation-report.json': opts.report } : {}),
  });
}

/** Load the unified report for every stack in the assembly. */
async function loadAll(assemblyDir: string): Promise<PluginReportJson[]> {
  const assembly = new CloudAssembly(assemblyDir);
  return loadUnifiedValidationReport(assembly, assembly.stacksRecursively);
}

function pluginReport(violations: PluginReportJson['violations'], pluginName = 'my-plugin'): PluginReportJson {
  return { pluginName, conclusion: 'failure', violations };
}

describe('plugin reports from validation-report.json', () => {
  test('returns an empty list when there is no report and no annotations', async () => {
    dir = assemblyWith({ stacks: [{ id: 'S' }] });

    expect(await loadAll(dir)).toEqual([]);
  });

  test('passes a plugin report through', async () => {
    dir = assemblyWith({
      stacks: [{ id: 'S' }],
      report: {
        version: '1.0.0',
        pluginReports: [pluginReport([{
          ruleName: 'no-public-buckets',
          description: 'S3 must not be public',
          severity: 'error',
          violatingConstructs: [{ constructPath: 'S/Bucket' }],
        }])],
      },
    });

    const reports = await loadAll(dir);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ pluginName: 'my-plugin', conclusion: 'failure' });
    expect(reports[0].violations[0].ruleName).toBe('no-public-buckets');
  });

  test('keeps a violation whose constructs have no path (cannot be attributed)', async () => {
    dir = assemblyWith({
      stacks: [{ id: 'S' }],
      report: {
        version: '1.0.0',
        pluginReports: [pluginReport([{
          ruleName: 'r',
          description: 'd',
          severity: 'error',
          violatingConstructs: [{ constructPath: '' }],
        }])],
      },
    });

    expect((await loadAll(dir))[0].violations).toHaveLength(1);
  });

  test('keeps a violation with no constructs at all', async () => {
    // Backwards compatibility: a construct-less violation is not stack-scoped,
    // so there is nothing to filter it out by.
    dir = assemblyWith({
      stacks: [{ id: 'S' }],
      report: {
        version: '1.0.0',
        pluginReports: [pluginReport([{ ruleName: 'r', description: 'd', severity: 'error', violatingConstructs: [] }])],
      },
    });

    expect((await loadAll(dir))[0].violations).toHaveLength(1);
  });
});

describe('filtering by selected stacks', () => {
  /** Report with one violation per stack, so filtering is observable. */
  function twoStackReport() {
    return {
      version: '1.0.0',
      pluginReports: [pluginReport([
        { ruleName: 'rA', description: 'dA', severity: 'error' as const, violatingConstructs: [{ constructPath: 'A/Bucket' }] },
        { ruleName: 'rB', description: 'dB', severity: 'error' as const, violatingConstructs: [{ constructPath: 'B/Bucket' }] },
      ])],
    };
  }

  test('drops violations belonging to unselected stacks', async () => {
    dir = assemblyWith({ stacks: [{ id: 'A' }, { id: 'B' }], report: twoStackReport() });
    const assembly = new CloudAssembly(dir);
    const onlyA = assembly.stacksRecursively.filter((s) => s.hierarchicalId === 'A');

    const reports = await loadUnifiedValidationReport(assembly, onlyA);

    expect(reports[0].violations.map((v) => v.ruleName)).toEqual(['rA']);
  });

  test('matches a stack by exact id as well as by prefix', async () => {
    dir = assemblyWith({
      stacks: [{ id: 'A' }],
      report: {
        version: '1.0.0',
        pluginReports: [pluginReport([
          { ruleName: 'onStack', description: 'd', severity: 'error', violatingConstructs: [{ constructPath: 'A' }] },
          { ruleName: 'inStack', description: 'd', severity: 'error', violatingConstructs: [{ constructPath: 'A/Bucket' }] },
          // "AB" must not match the "A" stack on a bare string prefix.
          { ruleName: 'otherStack', description: 'd', severity: 'error', violatingConstructs: [{ constructPath: 'AB/Bucket' }] },
        ])],
      },
    });

    expect((await loadAll(dir))[0].violations.map((v) => v.ruleName)).toEqual(['onStack', 'inStack']);
  });

  test('downgrades the conclusion to success when filtering removes every violation', async () => {
    dir = assemblyWith({ stacks: [{ id: 'A' }, { id: 'B' }], report: twoStackReport() });
    const assembly = new CloudAssembly(dir);
    const neither = assembly.stacksRecursively.filter(() => false);

    const reports = await loadUnifiedValidationReport(assembly, neither);

    expect(reports[0].violations).toEqual([]);
    expect(reports[0].conclusion).toBe('success');
  });
});

describe('construct annotations', () => {
  test('synthesizes a report from stack warnings and errors', async () => {
    dir = assemblyWith({
      stacks: [{
        id: 'S',
        annotations: [
          { level: 'warning', path: '/S/Bucket', message: 'be careful' },
          { level: 'error', path: '/S/Queue', message: 'very bad' },
        ],
      }],
    });

    const reports = await loadAll(dir);

    expect(reports).toHaveLength(1);
    // An error-level annotation makes the whole synthetic report a failure.
    expect(reports[0]).toMatchObject({ pluginName: ANNOTATIONS, conclusion: 'failure' });
    expect(reports[0].violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', description: 'be careful', ruleMetadata: { 'cdk:annotation': 'true' } }),
      expect.objectContaining({ severity: 'error', description: 'very bad' }),
    ]));
  });

  test('concludes success when only warnings are present', async () => {
    dir = assemblyWith({ stacks: [{ id: 'S', annotations: [{ level: 'warning', path: '/S/B', message: 'meh' }] }] });

    expect((await loadAll(dir))[0]).toMatchObject({ pluginName: ANNOTATIONS, conclusion: 'success' });
  });

  test('strips the leading slash off the construct path', async () => {
    dir = assemblyWith({ stacks: [{ id: 'S', annotations: [{ level: 'warning', path: '/S/Bucket', message: 'meh' }] }] });

    expect((await loadAll(dir))[0].violations[0].violatingConstructs).toEqual([expect.objectContaining({ constructPath: 'S/Bucket' })]);
  });

  test('groups the same annotation on several constructs into one violation', async () => {
    dir = assemblyWith({
      stacks: [{
        id: 'S',
        annotations: [
          { level: 'warning', path: '/S/A', message: 'same message' },
          { level: 'warning', path: '/S/B', message: 'same message' },
        ],
      }],
    });

    const violations = (await loadAll(dir))[0].violations;

    expect(violations).toHaveLength(1);
    expect(violations[0].violatingConstructs.map((c) => c.constructPath)).toEqual(['S/A', 'S/B']);
  });

  test.each([
    ['an [ack: id] tag in a warning', 'be careful [ack: my-rule]', 'my-rule', 'be careful'],
    ['a trailing (ns::id) in an error', 'very bad (ns::my-rule)', 'ns::my-rule', 'very bad'],
  ])('extracts the rule name from %s', async (_what, message, ruleName, description) => {
    dir = assemblyWith({ stacks: [{ id: 'S', annotations: [{ level: 'warning', path: '/S/B', message }] }] });

    expect((await loadAll(dir))[0].violations[0]).toMatchObject({ ruleName, description });
  });

  test('falls back to a severity-derived rule name when the message carries no id', async () => {
    dir = assemblyWith({ stacks: [{ id: 'S', annotations: [{ level: 'warning', path: '/S/B', message: 'plain' }] }] });

    expect((await loadAll(dir))[0].violations[0].ruleName).toBe('warning-annotation');
  });

  test('does not synthesize annotations when the report already carries them', async () => {
    // A newer aws-cdk-lib writes annotations into the report itself; re-deriving
    // them from metadata would double-report every finding.
    dir = assemblyWith({
      stacks: [{ id: 'S', annotations: [{ level: 'warning', path: '/S/B', message: 'from metadata' }] }],
      report: {
        version: '1.0.0',
        pluginReports: [pluginReport([{
          ruleName: 'r',
          description: 'from report',
          severity: 'warning',
          violatingConstructs: [{ constructPath: 'S/B' }],
        }], ANNOTATIONS)],
      },
    });

    const reports = await loadAll(dir);

    expect(reports).toHaveLength(1);
    expect(reports[0].violations.map((v) => v.description)).toEqual(['from report']);
  });

  test('appends annotations alongside an unrelated plugin report', async () => {
    dir = assemblyWith({
      stacks: [{ id: 'S', annotations: [{ level: 'warning', path: '/S/B', message: 'from metadata' }] }],
      report: {
        version: '1.0.0',
        pluginReports: [pluginReport([{
          ruleName: 'r',
          description: 'from plugin',
          severity: 'error',
          violatingConstructs: [{ constructPath: 'S/B' }],
        }])],
      },
    });

    expect((await loadAll(dir)).map((r) => r.pluginName)).toEqual(['my-plugin', ANNOTATIONS]);
  });
});
