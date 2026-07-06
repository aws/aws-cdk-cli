import { pathToFileURL } from 'url';
import { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
import { type Range } from 'vscode-languageserver/node';
import type { ConstructNode } from '../../lib/core/assembly-reader';
import type { ResourceConstruct } from '../../lib/lsp/codelens';
import { buildHover, hoverForPosition, type HoverLinks, renderValue, resourceNodesOnLine, selectPrimary } from '../../lib/lsp/hover';

const RANGE: Range = { start: { line: 9, character: 0 }, end: { line: 9, character: 0 } };
const FILE = '/app/lib/app.ts';
const FILE_URI = pathToFileURL(FILE).toString();

function res(
  path: string,
  logicalId: string,
  type: string,
  opts: { cfnProperties?: Record<string, unknown>; file?: string; line?: number } = {},
): ResourceConstruct {
  return {
    path,
    id: path.split('/').slice(-1)[0],
    logicalId,
    type,
    sourceLocation: { file: opts.file ?? FILE, line: opts.line ?? 10, column: 3 },
    cfnProperties: opts.cfnProperties,
    children: [],
  };
}

describe('renderValue', () => {
  test('quotes strings and truncates long ones', () => {
    expect(renderValue('nodejs16.x')).toBe('"nodejs16.x"');
    expect(renderValue('x'.repeat(80))).toBe(`"${'x'.repeat(59)}…"`);
  });

  test('renders primitives directly', () => {
    expect(renderValue(512)).toBe('512');
    expect(renderValue(true)).toBe('true');
    expect(renderValue(null)).toBe('null');
  });

  test('collapses arrays to a count', () => {
    expect(renderValue([])).toBe('[0 items]');
    expect(renderValue([1])).toBe('[1 item]');
    expect(renderValue([1, 2, 3])).toBe('[3 items]');
  });

  test('collapses objects to their first keys', () => {
    expect(renderValue({})).toBe('{}');
    expect(renderValue({ a: 1, b: 2 })).toBe('{ a, b }');
    expect(renderValue({ a: 1, b: 2, c: 3, d: 4, e: 5 })).toBe('{ a, b, c, d, … }');
  });

  test('renders intrinsics compactly', () => {
    expect(renderValue({ Ref: 'AppVpc80F1F7F9' })).toBe('{Ref AppVpc80F1F7F9}');
    expect(renderValue({ 'Fn::GetAtt': ['Role592E70E9', 'Arn'] })).toBe('{Fn::GetAtt Role592E70E9.Arn}');
    expect(renderValue({ 'Fn::Sub': 'arn:${X}' })).toBe('{Fn::Sub …}');
  });
});

describe('selectPrimary', () => {
  test('a single resource is its own primary', () => {
    const only = res('Stack/Bucket/Resource', 'B1', 'AWS::S3::Bucket');
    expect(selectPrimary([only])).toEqual({ primary: only, others: [] });
  });

  test('the uniquely shallowest resource is primary, the rest are others', () => {
    const fn = res('Stack/Fn/Resource', 'Fn1', 'AWS::Lambda::Function');
    const role = res('Stack/Fn/ServiceRole/Resource', 'Role1', 'AWS::IAM::Role');
    const policy = res('Stack/Fn/ServiceRole/DefaultPolicy/Resource', 'Pol1', 'AWS::IAM::Policy');
    expect(selectPrimary([role, fn, policy])).toEqual({ primary: fn, others: [role, policy] });
  });

  test('a tie at the shallowest depth has no single primary', () => {
    const lb = res('Stack/Svc/LB/Resource', 'Lb1', 'AWS::ElasticLoadBalancingV2::LoadBalancer');
    const task = res('Stack/Svc/Task/Resource', 'Task1', 'AWS::ECS::TaskDefinition');
    expect(selectPrimary([lb, task])).toBeUndefined();
  });
});

describe('buildHover', () => {
  const links: HoverLinks = {
    resourceLocations: {
      'Stack/Fn/Resource': { uri: FILE_URI, line: 5 },
      'Stack/Fn/ServiceRole/Resource': { uri: FILE_URI, line: 40 },
    },
    // resolveHoverLinks keys properties by lower-cased name (see HoverLinks).
    properties: { runtime: { uri: FILE_URI, line: 8 } },
  };

  test('returns undefined when no resource maps to the line', () => {
    expect(buildHover([], undefined, links, RANGE)).toBeUndefined();
  });

  test('links the logical id to its block and the value to its property line', () => {
    const fn = res('Stack/Fn/Resource', 'Fn1', 'AWS::Lambda::Function', { cfnProperties: { runtime: 'nodejs16.x' } });
    const value = buildHover([fn], selectPrimary([fn]), links, RANGE)!.contents as { value: string };
    expect(value.value).toContain(`[**Fn1**](${FILE_URI}#L5) · \`AWS::Lambda::Function\``);
    expect(value.value).toContain('`Stack/Fn/Resource`');
    expect(value.value).toContain(`- \`runtime\`: [\`"nodejs16.x"\`](${FILE_URI}#L8)`);
  });

  test('renders a value without a link when no range resolves for it', () => {
    const fn = res('Stack/Fn/Resource', 'Fn1', 'AWS::Lambda::Function', { cfnProperties: { memorySize: 512 } });
    const value = (buildHover([fn], selectPrimary([fn]), links, RANGE)!.contents as { value: string }).value;
    expect(value).toContain('- `memorySize`: `512`');
    expect(value).not.toContain('memorySize`]');
  });

  test('renders everything plainly when links are absent', () => {
    const fn = res('Stack/Fn/Resource', 'Fn1', 'AWS::Lambda::Function', { cfnProperties: { runtime: 'nodejs16.x' } });
    const value = (buildHover([fn], selectPrimary([fn]), undefined, RANGE)!.contents as { value: string }).value;
    expect(value).toContain('**Fn1** · `AWS::Lambda::Function`');
    expect(value).not.toContain('](');
  });

  test('caps properties and appends a "+N more" line', () => {
    const cfnProperties = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`p${i}`, i]));
    const fn = res('Stack/Fn/Resource', 'Fn1', 'AWS::Lambda::Function', { cfnProperties });
    const value = (buildHover([fn], selectPrimary([fn]), undefined, RANGE)!.contents as { value: string }).value;
    expect(value).toContain('- `p11`: `11`');
    expect(value).not.toContain('- `p12`:');
    expect(value).toContain('- +3 more');
  });

  test('shows only the primary values and lists the others under "Also creates"', () => {
    const fn = res('Stack/Fn/Resource', 'Fn1', 'AWS::Lambda::Function', { cfnProperties: { runtime: 'nodejs16.x' } });
    const role = res('Stack/Fn/ServiceRole/Resource', 'Role1', 'AWS::IAM::Role', { cfnProperties: { roleName: 'x' } });
    const nodes = [fn, role];
    const value = (buildHover(nodes, selectPrimary(nodes), links, RANGE)!.contents as { value: string }).value;
    expect(value).toContain('- `runtime`:');
    expect(value).not.toContain('roleName');
    expect(value).toContain(`Also creates: [\`AWS::IAM::Role\`](${FILE_URI}#L40)`);
  });

  test('collapses a large auxiliary set to a type histogram', () => {
    const vpc = res('Stack/Vpc/Resource', 'Vpc1', 'AWS::EC2::VPC');
    const aux = [
      ...Array.from({ length: 3 }, (_, i) => res(`Stack/Vpc/S${i}/Subnet`, `S${i}`, 'AWS::EC2::Subnet')),
      ...Array.from({ length: 2 }, (_, i) => res(`Stack/Vpc/R${i}/RouteTable`, `R${i}`, 'AWS::EC2::RouteTable')),
      res('Stack/Vpc/Igw/Resource', 'Igw1', 'AWS::EC2::InternetGateway'),
    ];
    const nodes = [vpc, ...aux];
    const value = (buildHover(nodes, selectPrimary(nodes), undefined, RANGE)!.contents as { value: string }).value;
    expect(value).toContain('Also creates 6 resources:');
    expect(value).toContain('3× Subnet');
    expect(value).toContain('2× RouteTable');
  });

  test('shows a resource summary when several resources tie at the shallowest depth', () => {
    const lb = res('Stack/Svc/LB/Resource', 'Lb1', 'AWS::ElasticLoadBalancingV2::LoadBalancer');
    const task = res('Stack/Svc/Task/Resource', 'Task1', 'AWS::ECS::TaskDefinition');
    const nodes = [lb, task];
    const value = (buildHover(nodes, selectPrimary(nodes), undefined, RANGE)!.contents as { value: string }).value;
    expect(value).toContain('**2 resources on this line**');
    expect(value).not.toContain('Also creates');
  });
});

describe('resourceNodesOnLine', () => {
  test('returns only resource nodes on the hovered file and line', () => {
    const onLine = res('Stack/Fn/Resource', 'Fn1', 'AWS::Lambda::Function', { line: 10 });
    const otherLine = res('Stack/Other/Resource', 'Ot1', 'AWS::S3::Bucket', { line: 20 });
    const otherFile = res('Stack/Elsewhere/Resource', 'El1', 'AWS::S3::Bucket', { file: '/app/lib/other.ts', line: 10 });
    const wrapper: ConstructNode = {
      path: 'Stack/Wrapper',
      id: 'Wrapper',
      sourceLocation: { file: FILE, line: 10, column: 1 },
      children: [],
    };
    const index = ConstructIndex.fromTree<ConstructNode>([onLine, otherLine, otherFile, wrapper]);

    const found = resourceNodesOnLine(index, FILE_URI, { line: 9, character: 0 });
    expect(found.map((n) => n.logicalId)).toEqual(['Fn1']);
  });
});

describe('hoverForPosition', () => {
  const TEMPLATE = JSON.stringify(
    { Resources: { Fn1: { Type: 'AWS::Lambda::Function', Properties: { Runtime: 'nodejs16.x' } } } },
    undefined,
    1,
  );

  test('resolves block and per-property links from the template', async () => {
    const fn: ResourceConstruct = {
      ...res('Stack/Fn/Resource', 'Fn1', 'AWS::Lambda::Function', { cfnProperties: { runtime: 'nodejs16.x' } }),
      templateFile: '/app/cdk.out/Stack.template.json',
    };
    const index = ConstructIndex.fromTree<ConstructNode>([fn]);
    const hover = await hoverForPosition(index, FILE_URI, { line: 9, character: 0 }, async () => TEMPLATE);
    const value = (hover!.contents as { value: string }).value;
    expect(value).toMatch(/\[\*\*Fn1\*\*\]\(file:.*#L\d+\) · `AWS::Lambda::Function`/);
    expect(value).toMatch(/- `runtime`: \[`"nodejs16\.x"`\]\(file:.*#L\d+\)/);
  });

  test('returns undefined when no resource is on the hovered line', async () => {
    const index = ConstructIndex.fromTree<ConstructNode>([res('Stack/Fn/Resource', 'Fn1', 'AWS::Lambda::Function')]);
    expect(await hoverForPosition(index, FILE_URI, { line: 99, character: 0 }, async () => '')).toBeUndefined();
  });
});
