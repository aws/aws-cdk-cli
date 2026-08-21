import type { ConstructNode } from '../../lib/core/assembly-reader';
import { toWebNode } from '../../lib/web/routes';

const ASSEMBLY_DIR = '/abs/cdk.out';
const APP_DIR = '/abs/app';
const NO_SEVERITY = new Map<string, string>();

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

describe('toWebNode', () => {
  test('relativizes a flat template to its bare name', () => {
    const web = toWebNode(
      makeNode({ path: 'S/B', id: 'B', logicalId: 'B123', templateFile: `${ASSEMBLY_DIR}/MyStack.template.json` }),
      NO_SEVERITY,
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.templateFile).toBe('MyStack.template.json');
  });

  test('keeps the sub-assembly directory for staged stacks', () => {
    const web = toWebNode(
      makeNode({
        path: 'Prod/S',
        id: 'S',
        logicalId: 'S1',
        templateFile: `${ASSEMBLY_DIR}/assembly-Prod/Prod-MyStack.template.json`,
      }),
      NO_SEVERITY,
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.templateFile).toBe('assembly-Prod/Prod-MyStack.template.json');
  });

  test('relativizes a source location inside the app dir', () => {
    const web = toWebNode(
      makeNode({ path: 'S/B', id: 'B', sourceLocation: { file: `${APP_DIR}/lib/stack.ts`, line: 12, column: 5 } }),
      NO_SEVERITY,
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.sourceLocation).toEqual({ file: 'lib/stack.ts', line: 12, column: 5 });
  });

  test('drops a source location that escapes the app dir', () => {
    const web = toWebNode(
      makeNode({ path: 'S/B', id: 'B', sourceLocation: { file: '/abs/other/lib.ts', line: 1, column: 1 } }),
      NO_SEVERITY,
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.sourceLocation).toBeUndefined();
  });

  test('leaves template and source undefined for a non-resource, non-TS node', () => {
    const web = toWebNode(makeNode({ path: 'S', id: 'S' }), NO_SEVERITY, ASSEMBLY_DIR, APP_DIR);
    expect(web.templateFile).toBeUndefined();
    expect(web.sourceLocation).toBeUndefined();
  });

  test('passes through type and logicalId', () => {
    const web = toWebNode(
      makeNode({ path: 'S/B', id: 'B', type: 'AWS::S3::Bucket', logicalId: 'B123' }),
      NO_SEVERITY,
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.type).toBe('AWS::S3::Bucket');
    expect(web.logicalId).toBe('B123');
  });

  test('recurses over children', () => {
    const tree = makeNode({
      path: 'S',
      id: 'S',
      children: [
        makeNode({ path: 'S/B', id: 'B', logicalId: 'B1', templateFile: `${ASSEMBLY_DIR}/S.template.json` }),
      ],
    });
    const web = toWebNode(tree, NO_SEVERITY, ASSEMBLY_DIR, APP_DIR);
    expect(web.children).toHaveLength(1);
    expect(web.children[0].path).toBe('S/B');
    expect(web.children[0].templateFile).toBe('S.template.json');
  });

  test('annotates a node with its violation severity', () => {
    const web = toWebNode(makeNode({ path: 'S/B', id: 'B' }), new Map([['S/B', 'error']]), ASSEMBLY_DIR, APP_DIR);
    expect(web.highestSeverity).toBe('error');
  });

  test('leaves highestSeverity undefined when the node has no violation', () => {
    const web = toWebNode(makeNode({ path: 'S/B', id: 'B' }), NO_SEVERITY, ASSEMBLY_DIR, APP_DIR);
    expect(web.highestSeverity).toBeUndefined();
  });
});

describe('toWebNode default-child collapse', () => {
  test('folds a leaf "Resource" child into its parent', () => {
    const web = toWebNode(
      makeNode({
        path: 'S/ItemsTable',
        id: 'ItemsTable',
        children: [
          makeNode({
            path: 'S/ItemsTable/Resource',
            id: 'Resource',
            type: 'AWS::DynamoDB::Table',
            logicalId: 'ItemsTable0ABC',
            templateFile: `${ASSEMBLY_DIR}/S.template.json`,
          }),
        ],
      }),
      NO_SEVERITY,
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.type).toBe('AWS::DynamoDB::Table');
    expect(web.logicalId).toBe('ItemsTable0ABC');
    expect(web.templateFile).toBe('S.template.json');
    expect(web.children).toHaveLength(0);
  });

  test('folds a leaf "Default" child too', () => {
    const web = toWebNode(
      makeNode({
        path: 'S/Custom',
        id: 'Custom',
        children: [makeNode({ path: 'S/Custom/Default', id: 'Default', type: 'AWS::CloudFormation::CustomResource' })],
      }),
      NO_SEVERITY,
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.type).toBe('AWS::CloudFormation::CustomResource');
    expect(web.children).toHaveLength(0);
  });

  test('collapses each construct independently, keeping siblings', () => {
    const web = toWebNode(
      makeNode({
        path: 'S/Bucket',
        id: 'Bucket',
        children: [
          makeNode({ path: 'S/Bucket/Resource', id: 'Resource', type: 'AWS::S3::Bucket', logicalId: 'Bucket1' }),
          makeNode({
            path: 'S/Bucket/Policy',
            id: 'Policy',
            children: [
              makeNode({ path: 'S/Bucket/Policy/Resource', id: 'Resource', type: 'AWS::S3::BucketPolicy', logicalId: 'Policy1' }),
            ],
          }),
        ],
      }),
      NO_SEVERITY,
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.type).toBe('AWS::S3::Bucket');
    expect(web.children).toHaveLength(1);
    expect(web.children[0].id).toBe('Policy');
    expect(web.children[0].type).toBe('AWS::S3::BucketPolicy');
    expect(web.children[0].children).toHaveLength(0);
  });

  test('does not collapse a "Resource" child that has its own children', () => {
    const web = toWebNode(
      makeNode({
        path: 'S/Weird',
        id: 'Weird',
        children: [
          makeNode({
            path: 'S/Weird/Resource',
            id: 'Resource',
            type: 'AWS::Some::Thing',
            children: [makeNode({ path: 'S/Weird/Resource/Inner', id: 'Inner' })],
          }),
        ],
      }),
      NO_SEVERITY,
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.type).toBeUndefined();
    expect(web.children).toHaveLength(1);
    expect(web.children[0].id).toBe('Resource');
  });

  test('does not collapse a "Resource" child with no CFN type', () => {
    const web = toWebNode(
      makeNode({ path: 'S/X', id: 'X', children: [makeNode({ path: 'S/X/Resource', id: 'Resource' })] }),
      NO_SEVERITY,
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.type).toBeUndefined();
    expect(web.children).toHaveLength(1);
  });

  test('keeps the parent source location (relativized), falling back to the child when absent', () => {
    const parentLoc = { file: `${APP_DIR}/lib/s.ts`, line: 5, column: 2 };
    const childLoc = { file: `${APP_DIR}/lib/s.ts`, line: 99, column: 9 };
    const kept = toWebNode(
      makeNode({
        path: 'S/T',
        id: 'T',
        sourceLocation: parentLoc,
        children: [makeNode({ path: 'S/T/Resource', id: 'Resource', type: 'AWS::X::Y', sourceLocation: childLoc })],
      }),
      NO_SEVERITY,
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(kept.sourceLocation).toEqual({ file: 'lib/s.ts', line: 5, column: 2 });

    const fellBack = toWebNode(
      makeNode({
        path: 'S/T',
        id: 'T',
        children: [makeNode({ path: 'S/T/Resource', id: 'Resource', type: 'AWS::X::Y', sourceLocation: childLoc })],
      }),
      NO_SEVERITY,
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(fellBack.sourceLocation).toEqual({ file: 'lib/s.ts', line: 99, column: 9 });
  });

  test("folds an absorbed default child's severity into the parent", () => {
    const web = toWebNode(
      makeNode({
        path: 'S/T',
        id: 'T',
        children: [makeNode({ path: 'S/T/Resource', id: 'Resource', type: 'AWS::X::Y' })],
      }),
      new Map([['S/T/Resource', 'error']]),
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.highestSeverity).toBe('error');
    expect(web.children).toHaveLength(0);
  });

  test('takes the more severe of the parent and the absorbed child', () => {
    const web = toWebNode(
      makeNode({
        path: 'S/T',
        id: 'T',
        children: [makeNode({ path: 'S/T/Resource', id: 'Resource', type: 'AWS::X::Y' })],
      }),
      new Map([['S/T', 'warning'], ['S/T/Resource', 'error']]),
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.highestSeverity).toBe('error');
  });

  test("does not attribute an uncollapsed Resource child's severity to its parent", () => {
    const web = toWebNode(
      makeNode({
        path: 'S/Weird',
        id: 'Weird',
        children: [
          makeNode({
            path: 'S/Weird/Resource',
            id: 'Resource',
            type: 'AWS::Some::Thing',
            children: [makeNode({ path: 'S/Weird/Resource/Inner', id: 'Inner' })],
          }),
        ],
      }),
      new Map([['S/Weird/Resource', 'error']]),
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.highestSeverity).toBeUndefined();
    expect(web.children[0].highestSeverity).toBe('error');
  });
});
