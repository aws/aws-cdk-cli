import type { AssemblyIndexNode } from '@aws-cdk/cloud-assembly-api';
import { toWebNode } from '../../lib/web/routes';
import type { WebConstructNode } from '../../lib/web-shared/protocol';
import { AssemblyFixture } from '../_helpers/assembly';

const NO_SEVERITY = new Map<string, string>();

let fixture: AssemblyFixture | undefined;

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

/**
 * Convert the one stack in a fixture to its wire form. Returns the stack node,
 * whose children are what most assertions here look at.
 */
async function webTree(
  spec: Parameters<typeof AssemblyFixture.create>[0],
  severityByPath: ReadonlyMap<string, string> = NO_SEVERITY,
): Promise<WebConstructNode> {
  fixture = AssemblyFixture.create(spec);
  const index = await fixture.index();
  const [stack] = index.assemblyIndex.firstLevelChildren;
  return toWebNode(index, stack, severityByPath, fixture.assemblyDir, fixture.appDir);
}

/** Find a node by construct path in a wire tree. */
function find(node: WebConstructNode, constructPath: string): WebConstructNode | undefined {
  if (node.path === constructPath) return node;
  for (const child of node.children) {
    const found = find(child, constructPath);
    if (found) return found;
  }
  return undefined;
}

describe('toWebNode', () => {
  test('maps a resource to its wire shape with app-relative source and assembly-relative template', async () => {
    const stack = await webTree({
      sourceFiles: { 'lib/stack.ts': '\n'.repeat(20) },
      stacks: [{ id: 'S', resources: [{ path: 'Bucket/Resource', logicalId: 'B123', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' }] }],
    });

    // The leaf folds into its parent, so the L2 carries the resource data.
    const bucket = find(stack, 'S/Bucket')!;
    expect(bucket.type).toBe('AWS::S3::Bucket');
    expect(bucket.templateLocation).toEqual({ file: 'S.template.json', logicalId: 'B123' });
    expect(bucket.sourceLocation).toEqual({ file: 'lib/stack.ts', line: 12, column: 5 });
  });

  test('uses POSIX separators in a nested source path', async () => {
    const stack = await webTree({
      sourceFiles: { 'lib/nested/deep.ts': '\n'.repeat(5) },
      stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/nested/deep.ts:3:1' }] }],
    });

    expect(find(stack, 'S/B')!.sourceLocation!.file).toBe('lib/nested/deep.ts');
  });

  test('marks a source location outside the app dir rather than leaking the path', async () => {
    // A construct created by a library outside the app tree. The path cannot be
    // served by /api/file, so the index replaces it with a contained sentinel
    // instead of emitting a '../' path that escapes the app dir.
    const stack = await webTree({
      stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: '/elsewhere/lib.ts:4:2' }] }],
    });

    expect(find(stack, 'S/B')!.sourceLocation!.file).toBe('ESCAPING');
  });

  test('leaves source and template undefined for a construct with no creation stack', async () => {
    // Non-TypeScript app: no creation stack recorded, and no tree.json means no
    // CFN type either.
    const stack = await webTree({
      withoutTree: true,
      stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1' }] }],
    });

    const node = find(stack, 'S/B/Resource')!;
    expect(node.sourceLocation).toBeUndefined();
    expect(node.type).toBeUndefined();
  });

  test('recurses over siblings, keeping each subtree', async () => {
    const stack = await webTree({
      sourceFiles: { 'lib/stack.ts': '\n'.repeat(40) },
      stacks: [{
        id: 'S',
        resources: [
          { path: 'Bucket/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:10:1' },
          { path: 'Queue/Resource', logicalId: 'Q1', type: 'AWS::SQS::Queue', at: 'lib/stack.ts:20:1' },
        ],
      }],
    });

    expect(stack.children.map((c) => c.id).sort()).toEqual(['Bucket', 'Queue']);
    expect(find(stack, 'S/Bucket')!.type).toBe('AWS::S3::Bucket');
    expect(find(stack, 'S/Queue')!.type).toBe('AWS::SQS::Queue');
  });

  test('annotates a node with its own violation severity', async () => {
    const stack = await webTree(
      { stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket' }] }] },
      new Map([['S/B', 'error']]),
    );

    expect(find(stack, 'S/B')!.highestSeverity).toBe('error');
  });

  test('leaves severity undefined when nothing in the tree has a violation', async () => {
    const stack = await webTree({ stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket' }] }] });

    expect(find(stack, 'S/B')!.highestSeverity).toBeUndefined();
    expect(find(stack, 'S/B')!.inheritedSeverity).toBeUndefined();
  });

  test('propagates a descendant severity to its ancestors as inherited', async () => {
    const stack = await webTree(
      { stacks: [{ id: 'S', resources: [{ path: 'Outer/Inner/Resource', logicalId: 'I1', type: 'AWS::S3::Bucket' }] }] },
      new Map([['S/Outer/Inner', 'warning']]),
    );

    // The offending node owns it; ancestors show it as inherited so the tree can
    // be coloured for drill-down.
    expect(find(stack, 'S/Outer/Inner')!.highestSeverity).toBe('warning');
    expect(find(stack, 'S/Outer')!.inheritedSeverity).toBe('warning');
    expect(find(stack, 'S/Outer')!.highestSeverity).toBeUndefined();
    expect(stack.inheritedSeverity).toBe('warning');
  });

  test('a node own severity wins over an inherited one', async () => {
    const stack = await webTree(
      { stacks: [{ id: 'S', resources: [{ path: 'Outer/Inner/Resource', logicalId: 'I1', type: 'AWS::S3::Bucket' }] }] },
      new Map([['S/Outer', 'error'], ['S/Outer/Inner', 'warning']]),
    );

    expect(find(stack, 'S/Outer')!.highestSeverity).toBe('error');
    expect(find(stack, 'S/Outer')!.inheritedSeverity).toBeUndefined();
  });
});

describe('toWebNode default-child collapse', () => {
  test('folds a leaf Resource child into its parent', async () => {
    const stack = await webTree({
      stacks: [{ id: 'S', resources: [{ path: 'ItemsTable/Resource', logicalId: 'Items0ABC', type: 'AWS::DynamoDB::Table' }] }],
    });

    const table = find(stack, 'S/ItemsTable')!;
    expect(table.type).toBe('AWS::DynamoDB::Table');
    expect(table.templateLocation).toEqual({ file: 'S.template.json', logicalId: 'Items0ABC' });
    // The redundant leaf is gone from the displayed tree.
    expect(table.children).toHaveLength(0);
    expect(find(stack, 'S/ItemsTable/Resource')).toBeUndefined();
  });

  test('folds a leaf Default child too', async () => {
    const stack = await webTree({
      stacks: [{ id: 'S', resources: [{ path: 'Custom/Default', logicalId: 'C1', type: 'AWS::CloudFormation::CustomResource' }] }],
    });

    expect(find(stack, 'S/Custom')!.type).toBe('AWS::CloudFormation::CustomResource');
    expect(find(stack, 'S/Custom')!.children).toHaveLength(0);
  });

  test('collapses each construct independently, keeping siblings', async () => {
    const stack = await webTree({
      stacks: [{
        id: 'S',
        resources: [
          { path: 'Bucket/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket' },
          { path: 'Bucket/Policy/Resource', logicalId: 'P1', type: 'AWS::S3::BucketPolicy' },
        ],
      }],
    });

    const bucket = find(stack, 'S/Bucket')!;
    expect(bucket.type).toBe('AWS::S3::Bucket');
    expect(bucket.children.map((c) => c.id)).toEqual(['Policy']);
    expect(bucket.children[0].type).toBe('AWS::S3::BucketPolicy');
    expect(bucket.children[0].children).toHaveLength(0);
  });

  test('does not collapse a Resource child that has its own children', async () => {
    const stack = await webTree({
      stacks: [{
        id: 'S',
        resources: [
          { path: 'Weird/Resource', logicalId: 'W1', type: 'AWS::Some::Thing' },
          { path: 'Weird/Resource/Inner', logicalId: 'W2', type: 'AWS::Other::Thing' },
        ],
      }],
    });

    expect(find(stack, 'S/Weird')!.type).toBeUndefined();
    expect(find(stack, 'S/Weird')!.children.map((c) => c.id)).toEqual(['Resource']);
  });

  test('does not collapse a Resource child with no CFN type', async () => {
    const stack = await webTree({
      withoutTree: true,
      stacks: [{ id: 'S', resources: [{ path: 'X/Resource', logicalId: 'X1' }] }],
    });

    expect(find(stack, 'S/X')!.type).toBeUndefined();
    expect(find(stack, 'S/X')!.children.map((c) => c.id)).toEqual(['Resource']);
  });

  test('prefers the parent source location, falling back to the folded child', async () => {
    const withParentLocation = await webTree({
      sourceFiles: { 'lib/s.ts': '\n'.repeat(120) },
      stacks: [{
        id: 'S',
        resources: [
          { path: 'T', logicalId: 'Twrapper', at: 'lib/s.ts:5:2' },
          { path: 'T/Resource', logicalId: 'T1', type: 'AWS::X::Y', at: 'lib/s.ts:99:9' },
        ],
      }],
    });
    expect(find(withParentLocation, 'S/T')!.sourceLocation).toEqual({ file: 'lib/s.ts', line: 5, column: 2 });

    const withoutParentLocation = await webTree({
      sourceFiles: { 'lib/s.ts': '\n'.repeat(120) },
      stacks: [{ id: 'S', resources: [{ path: 'T/Resource', logicalId: 'T1', type: 'AWS::X::Y', at: 'lib/s.ts:99:9' }] }],
    });
    expect(find(withoutParentLocation, 'S/T')!.sourceLocation).toEqual({ file: 'lib/s.ts', line: 99, column: 9 });
  });

  test('folds an absorbed default child severity into the parent', async () => {
    const stack = await webTree(
      { stacks: [{ id: 'S', resources: [{ path: 'T/Resource', logicalId: 'T1', type: 'AWS::X::Y' }] }] },
      new Map([['S/T/Resource', 'error']]),
    );

    // The dot must track the node the user actually sees.
    expect(find(stack, 'S/T')!.highestSeverity).toBe('error');
    expect(find(stack, 'S/T')!.children).toHaveLength(0);
  });

  test('takes the more severe of the parent and the absorbed child', async () => {
    const stack = await webTree(
      { stacks: [{ id: 'S', resources: [{ path: 'T/Resource', logicalId: 'T1', type: 'AWS::X::Y' }] }] },
      new Map([['S/T', 'warning'], ['S/T/Resource', 'error']]),
    );

    expect(find(stack, 'S/T')!.highestSeverity).toBe('error');
  });

  test('does not attribute an uncollapsed Resource child severity to its parent', async () => {
    const stack = await webTree(
      {
        stacks: [{
          id: 'S',
          resources: [
            { path: 'Weird/Resource', logicalId: 'W1', type: 'AWS::Some::Thing' },
            { path: 'Weird/Resource/Inner', logicalId: 'W2', type: 'AWS::Other::Thing' },
          ],
        }],
      },
      new Map([['S/Weird/Resource', 'error']]),
    );

    expect(find(stack, 'S/Weird')!.highestSeverity).toBeUndefined();
    expect(find(stack, 'S/Weird')!.inheritedSeverity).toBe('error');
    expect(find(stack, 'S/Weird/Resource')!.highestSeverity).toBe('error');
  });
});

describe('toWebNode on a bare node', () => {
  test('a construct with no CFN resource yields no template location', async () => {
    fixture = AssemblyFixture.create({ stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket' }] }] });
    const index = await fixture.index();
    const plain: AssemblyIndexNode = { constructPath: 'S', id: 'S', cfnResource: {}, children: {} };

    const web = toWebNode(index, plain, NO_SEVERITY, fixture.assemblyDir, fixture.appDir);

    expect(web.templateLocation).toBeUndefined();
    expect(web.type).toBeUndefined();
    expect(web.children).toEqual([]);
  });
});
