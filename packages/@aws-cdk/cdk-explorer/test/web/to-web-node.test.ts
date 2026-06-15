import type { ConstructNode } from '../../lib/core/assembly-reader';
import { collapseDefaultChildren, toWebNode } from '../../lib/web/routes';

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

describe('toWebNode', () => {
  test('relativizes a flat template to its bare name', () => {
    const web = toWebNode(
      makeNode({ path: 'S/B', id: 'B', logicalId: 'B123', templateFile: `${ASSEMBLY_DIR}/MyStack.template.json` }),
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
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.templateFile).toBe('assembly-Prod/Prod-MyStack.template.json');
  });

  test('relativizes a source location inside the app dir', () => {
    const web = toWebNode(
      makeNode({ path: 'S/B', id: 'B', sourceLocation: { file: `${APP_DIR}/lib/stack.ts`, line: 12, column: 5 } }),
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.sourceLocation).toEqual({ file: 'lib/stack.ts', line: 12, column: 5 });
  });

  test('drops a source location that escapes the app dir', () => {
    const web = toWebNode(
      makeNode({ path: 'S/B', id: 'B', sourceLocation: { file: '/abs/other/lib.ts', line: 1, column: 1 } }),
      ASSEMBLY_DIR,
      APP_DIR,
    );
    expect(web.sourceLocation).toBeUndefined();
  });

  test('leaves template and source undefined for a non-resource, non-TS node', () => {
    const web = toWebNode(makeNode({ path: 'S', id: 'S' }), ASSEMBLY_DIR, APP_DIR);
    expect(web.templateFile).toBeUndefined();
    expect(web.sourceLocation).toBeUndefined();
  });

  test('passes through type and logicalId', () => {
    const web = toWebNode(
      makeNode({ path: 'S/B', id: 'B', type: 'AWS::S3::Bucket', logicalId: 'B123' }),
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
    const web = toWebNode(tree, ASSEMBLY_DIR, APP_DIR);
    expect(web.children).toHaveLength(1);
    expect(web.children[0].path).toBe('S/B');
    expect(web.children[0].templateFile).toBe('S.template.json');
  });
});

describe('collapseDefaultChildren', () => {
  test('folds a leaf "Resource" child into its parent', () => {
    const collapsed = collapseDefaultChildren(
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
    );
    expect(collapsed.type).toBe('AWS::DynamoDB::Table');
    expect(collapsed.logicalId).toBe('ItemsTable0ABC');
    expect(collapsed.templateFile).toBe(`${ASSEMBLY_DIR}/S.template.json`);
    expect(collapsed.children).toHaveLength(0);
  });

  test('folds a leaf "Default" child too', () => {
    const collapsed = collapseDefaultChildren(
      makeNode({
        path: 'S/Custom',
        id: 'Custom',
        children: [makeNode({ path: 'S/Custom/Default', id: 'Default', type: 'AWS::CloudFormation::CustomResource' })],
      }),
    );
    expect(collapsed.type).toBe('AWS::CloudFormation::CustomResource');
    expect(collapsed.children).toHaveLength(0);
  });

  test('collapses each construct independently, keeping siblings', () => {
    const collapsed = collapseDefaultChildren(
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
    );
    expect(collapsed.type).toBe('AWS::S3::Bucket');
    expect(collapsed.children).toHaveLength(1);
    expect(collapsed.children[0].id).toBe('Policy');
    expect(collapsed.children[0].type).toBe('AWS::S3::BucketPolicy');
    expect(collapsed.children[0].children).toHaveLength(0);
  });

  test('does not collapse a "Resource" child that has its own children', () => {
    const collapsed = collapseDefaultChildren(
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
    );
    expect(collapsed.type).toBeUndefined();
    expect(collapsed.children).toHaveLength(1);
    expect(collapsed.children[0].id).toBe('Resource');
  });

  test('does not collapse a "Resource" child with no CFN type', () => {
    const collapsed = collapseDefaultChildren(
      makeNode({ path: 'S/X', id: 'X', children: [makeNode({ path: 'S/X/Resource', id: 'Resource' })] }),
    );
    expect(collapsed.type).toBeUndefined();
    expect(collapsed.children).toHaveLength(1);
  });

  test('keeps the parent source location, falling back to the child when absent', () => {
    const parentLoc = { file: '/abs/app/lib/s.ts', line: 5, column: 2 };
    const childLoc = { file: '/abs/app/lib/s.ts', line: 99, column: 9 };
    const kept = collapseDefaultChildren(
      makeNode({
        path: 'S/T',
        id: 'T',
        sourceLocation: parentLoc,
        children: [makeNode({ path: 'S/T/Resource', id: 'Resource', type: 'AWS::X::Y', sourceLocation: childLoc })],
      }),
    );
    expect(kept.sourceLocation).toEqual(parentLoc);

    const fellBack = collapseDefaultChildren(
      makeNode({
        path: 'S/T',
        id: 'T',
        children: [makeNode({ path: 'S/T/Resource', id: 'Resource', type: 'AWS::X::Y', sourceLocation: childLoc })],
      }),
    );
    expect(fellBack.sourceLocation).toEqual(childLoc);
  });
});
