import type { PluginReportJson } from '@aws-cdk/cloud-assembly-schema';
import { normalizeViolations } from '../../lib/web/routes';
import { AssemblyFixture } from '../_helpers/assembly';

let fixture: AssemblyFixture | undefined;

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

/** A one-plugin report carrying a single rule over the given violating constructs. */
function report(violatingConstructs: PluginReportJson['violations'][number]['violatingConstructs']): PluginReportJson[] {
  return [{
    pluginName: 'cdk-validator',
    conclusion: 'failure',
    violations: [{
      ruleName: 'no-public-access',
      description: 'S3 bucket should not allow public access',
      severity: 'error',
      suggestedFix: 'set blockPublicAccess',
      violatingConstructs,
    }],
  }];
}

/** Index an app whose single bucket is created at lib/stack.ts:12:5. */
async function indexWithBucket() {
  fixture = AssemblyFixture.create({
    sourceFiles: { 'lib/stack.ts': '\n'.repeat(20) },
    stacks: [{ id: 'MyStack', resources: [{ path: 'Bucket/Resource', logicalId: 'Bucket123', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' }] }],
  });
  return fixture.index();
}

describe('normalizeViolations', () => {
  test('carries the rule metadata through unchanged', async () => {
    const index = await indexWithBucket();

    const out = normalizeViolations(report([{ constructPath: 'MyStack/Bucket/Resource' }]), index);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      ruleName: 'no-public-access',
      description: 'S3 bucket should not allow public access',
      severity: 'error',
      source: 'cdk-validator',
      suggestedFix: 'set blockPublicAccess',
    });
  });

  test('prefers indexed resource data over the report own fields', async () => {
    const index = await indexWithBucket();

    const [occurrence] = normalizeViolations(report([{
      constructPath: 'MyStack/Bucket/Resource',
      cloudFormationResource: { templatePath: 'STALE.json', logicalId: 'STALE', propertyPaths: ['Properties.PublicAccessBlock'] },
    }]), index)[0].occurrences;

    expect(occurrence).toMatchObject({
      constructPath: 'MyStack/Bucket/Resource',
      logicalId: 'Bucket123',
      templateFile: 'MyStack.template.json',
      propertyPaths: ['Properties.PublicAccessBlock'],
    });
  });

  test('resolves the source location app-relative from the creation stack', async () => {
    const index = await indexWithBucket();

    const [occurrence] = normalizeViolations(report([{ constructPath: 'MyStack/Bucket/Resource' }]), index)[0].occurrences;

    expect(occurrence.sourceLocations).toEqual([{ file: 'lib/stack.ts', line: 12, column: 5 }]);
  });

  test('uses the report own stack traces when it supplies them', async () => {
    const index = await indexWithBucket();

    const [occurrence] = normalizeViolations(report([{
      constructPath: 'MyStack/Bucket/Resource',
      stackTraces: [`...aws-cdk-lib...\nrule (${fixture!.sourcePath('lib/stack.ts')}:3:1)`],
    }]), index)[0].occurrences;

    // The plugin pinpointed the violation, which beats the construct's creation site.
    expect(occurrence.sourceLocations).toEqual([{ file: 'lib/stack.ts', line: 3, column: 1 }]);
  });

  test('falls back to the report resource fields for a construct absent from the index', async () => {
    const index = await indexWithBucket();

    const [occurrence] = normalizeViolations(report([{
      constructPath: 'Other/X',
      cloudFormationResource: { templatePath: 'Other.template.json', logicalId: 'X9', propertyPaths: ['P'] },
    }]), index)[0].occurrences;

    expect(occurrence).toMatchObject({
      constructPath: 'Other/X',
      logicalId: 'X9',
      templateFile: 'Other.template.json',
      propertyPaths: ['P'],
    });
    expect(occurrence.sourceLocations).toEqual([]);
  });

  test('leaves resource fields undefined when neither the index nor the report has them', async () => {
    const index = await indexWithBucket();

    const [occurrence] = normalizeViolations(report([{ constructPath: 'Ghost' }]), index)[0].occurrences;

    expect(occurrence.logicalId).toBeUndefined();
    expect(occurrence.templateFile).toBeUndefined();
    expect(occurrence.propertyPaths).toBeUndefined();
    expect(occurrence.sourceLocations).toEqual([]);
  });

  test('flattens violations across plugins, preserving order', async () => {
    const index = await indexWithBucket();

    const out = normalizeViolations([
      { pluginName: 'a', conclusion: 'failure', violations: [{ ruleName: 'r1', description: 'd1', severity: 'warning', violatingConstructs: [] }] },
      { pluginName: 'b', conclusion: 'failure', violations: [{ ruleName: 'r2', description: 'd2', severity: 'fatal', customSeverity: 'BLOCKER', violatingConstructs: [] }] },
    ], index);

    expect(out.map((v) => v.source)).toEqual(['a', 'b']);
    expect(out[1]).toMatchObject({ severity: 'fatal', customSeverity: 'BLOCKER' });
  });

  test('emits one occurrence per violating construct', async () => {
    const index = await indexWithBucket();

    const [violation] = normalizeViolations(report([
      { constructPath: 'MyStack/Bucket/Resource' },
      { constructPath: 'Other/X' },
    ]), index);

    expect(violation.occurrences.map((o) => o.constructPath)).toEqual(['MyStack/Bucket/Resource', 'Other/X']);
  });

  test('returns an empty list for an absent report', async () => {
    expect(normalizeViolations(undefined, await indexWithBucket())).toEqual([]);
  });
});
