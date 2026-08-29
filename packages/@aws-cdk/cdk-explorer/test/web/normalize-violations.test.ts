import { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
import type { PolicyValidationReportJson } from '@aws-cdk/cloud-assembly-schema';
import type { ConstructNode } from '../../lib/core/assembly-reader';
import { normalizeViolations } from '../../lib/web/routes';

const ASSEMBLY_DIR = '/abs/cdk.out';
const APP_DIR = '/abs/app';

function makeNode(props: {
  path: string;
  id: string;
  type?: string;
  logicalId?: string;
  templateFile?: string;
  sourceLocation?: { file: string; line: number; column: number };
  children?: ConstructNode[];
}): ConstructNode {
  return { ...props, children: props.children ?? [] };
}

function report(violatingConstructs: PolicyValidationReportJson['pluginReports'][number]['violations'][number]['violatingConstructs']): PolicyValidationReportJson {
  return {
    version: '1.0',
    pluginReports: [
      {
        pluginName: 'cdk-validator',
        conclusion: 'failure',
        violations: [
          {
            ruleName: 'no-public-access',
            description: 'S3 bucket should not allow public access',
            severity: 'error',
            suggestedFix: 'set blockPublicAccess',
            violatingConstructs,
          },
        ],
      },
    ],
  };
}

describe('normalizeViolations', () => {
  test('prefers resolved tree data over the report when the construct is in the index', () => {
    const index = ConstructIndex.fromTree<ConstructNode>([
      makeNode({
        path: 'MyStack/Bucket',
        id: 'Bucket',
        type: 'AWS::S3::Bucket',
        logicalId: 'Bucket123',
        templateFile: `${ASSEMBLY_DIR}/MyStack.template.json`,
        sourceLocation: { file: `${APP_DIR}/lib/stack.ts`, line: 12, column: 5 },
      }),
    ]);
    const r = report([
      {
        constructPath: 'MyStack/Bucket',
        cloudFormationResource: { templatePath: 'IGNORED.json', logicalId: 'IGNORED', propertyPaths: ['Properties.PublicAccessBlock'] },
      },
    ]);

    const out = normalizeViolations(r, index, ASSEMBLY_DIR, APP_DIR);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      ruleName: 'no-public-access',
      description: 'S3 bucket should not allow public access',
      severity: 'error',
      source: 'cdk-validator',
      suggestedFix: 'set blockPublicAccess',
    });
    expect(out[0].occurrences[0]).toEqual({
      constructPath: 'MyStack/Bucket',
      logicalId: 'Bucket123',
      templateFile: 'MyStack.template.json',
      sourceLocation: { file: 'lib/stack.ts', line: 12, column: 5 },
      propertyPaths: ['Properties.PublicAccessBlock'],
    });
  });

  test('falls back to the report resource fields when the construct is not in the index', () => {
    const index = ConstructIndex.fromTree<ConstructNode>([]);
    const r = report([
      {
        constructPath: 'Other/X',
        cloudFormationResource: { templatePath: 'Other.template.json', logicalId: 'X9', propertyPaths: ['P'] },
      },
    ]);

    const occ = normalizeViolations(r, index, ASSEMBLY_DIR, APP_DIR)[0].occurrences[0];

    expect(occ.constructPath).toBe('Other/X');
    expect(occ.logicalId).toBe('X9');
    expect(occ.templateFile).toBe('Other.template.json');
    expect(occ.sourceLocation).toBeUndefined();
    expect(occ.propertyPaths).toEqual(['P']);
  });

  test('leaves resource fields undefined when neither the index nor the report has them', () => {
    const index = ConstructIndex.fromTree<ConstructNode>([]);
    const occ = normalizeViolations(report([{ constructPath: 'Ghost' }]), index, ASSEMBLY_DIR, APP_DIR)[0].occurrences[0];
    expect(occ.logicalId).toBeUndefined();
    expect(occ.templateFile).toBeUndefined();
    expect(occ.sourceLocation).toBeUndefined();
    expect(occ.propertyPaths).toBeUndefined();
  });

  test('flattens violations across plugins', () => {
    const index = ConstructIndex.fromTree<ConstructNode>([]);
    const r: PolicyValidationReportJson = {
      version: '1.0',
      pluginReports: [
        { pluginName: 'a', conclusion: 'failure', violations: [{ ruleName: 'r1', description: 'd1', severity: 'warning', violatingConstructs: [] }] },
        { pluginName: 'b', conclusion: 'failure', violations: [{ ruleName: 'r2', description: 'd2', severity: 'fatal', customSeverity: 'BLOCKER', violatingConstructs: [] }] },
      ],
    };

    const out = normalizeViolations(r, index, ASSEMBLY_DIR, APP_DIR);

    expect(out).toHaveLength(2);
    expect(out.map((v) => v.source)).toEqual(['a', 'b']);
    expect(out[1]).toMatchObject({ severity: 'fatal', customSeverity: 'BLOCKER' });
  });

  test('returns an empty list for an undefined report', () => {
    expect(normalizeViolations(undefined, ConstructIndex.fromTree<ConstructNode>([]), ASSEMBLY_DIR, APP_DIR)).toEqual([]);
  });
});
