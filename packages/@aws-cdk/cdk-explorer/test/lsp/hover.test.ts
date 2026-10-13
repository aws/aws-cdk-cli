import { type Range } from 'vscode-languageserver/node';
import type { AssemblyResourceNode } from '../../lib/core/assembly-index-with-source-locations';
import { buildHover, hoverForPosition, type HoverLinks, renderValue, resourceNodesOnLine, selectPrimary } from '../../lib/lsp/hover';
import { AssemblyFixture, type AssemblySpec } from '../_helpers/assembly';

const RANGE: Range = { start: { line: 9, character: 0 }, end: { line: 9, character: 0 } };
const LINK_URI = 'file:///app/cdk.out/S.template.json';
const SOURCE = { 'lib/app.ts': '\n'.repeat(40), 'lib/other.ts': '\n'.repeat(40) };

/** The LogSink hoverForPosition writes template-read failures to. */
function makeLog() {
  return { warn: jest.fn(), error: jest.fn() };
}

let fixture: AssemblyFixture | undefined;

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

/** A resource node as the index produces them, for the pure rendering functions. */
function res(
  constructPath: string,
  logicalId: string,
  type: string,
  cfnProperties?: Record<string, unknown>,
): AssemblyResourceNode {
  return {
    constructPath,
    id: constructPath.split('/').slice(-1)[0],
    cfnResource: { logicalId, type, assemblyRelativeTemplateFile: 'S.template.json', cfnProperties },
  };
}

/** Markdown body of a hover built from `nodes`. */
function hoverText(nodes: readonly AssemblyResourceNode[], links?: HoverLinks): string {
  return (buildHover(nodes, selectPrimary(nodes), links, RANGE)!.contents as { value: string }).value;
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

  test('renders CFN intrinsics compactly', () => {
    expect(renderValue({ Ref: 'AppVpc80F1F7F9' })).toBe('{Ref AppVpc80F1F7F9}');
    expect(renderValue({ 'Fn::GetAtt': ['Role592E70E9', 'Arn'] })).toBe('{Fn::GetAtt Role592E70E9.Arn}');
    expect(renderValue({ 'Fn::Sub': 'arn:${X}' })).toBe('{Fn::Sub …}');
  });

  test('treats a two-key object as data, not an intrinsic', () => {
    expect(renderValue({ Ref: 'X', Other: 1 })).toBe('{ Ref, Other }');
  });
});

describe('selectPrimary', () => {
  test('a single resource is its own primary', () => {
    const only = res('S/Bucket/Resource', 'B1', 'AWS::S3::Bucket');
    expect(selectPrimary([only])).toEqual({ primary: only, others: [] });
  });

  test('the uniquely shallowest resource is primary', () => {
    const fn = res('S/Fn/Resource', 'Fn1', 'AWS::Lambda::Function');
    const role = res('S/Fn/ServiceRole/Resource', 'Role1', 'AWS::IAM::Role');
    const policy = res('S/Fn/ServiceRole/DefaultPolicy/Resource', 'Pol1', 'AWS::IAM::Policy');

    expect(selectPrimary([role, fn, policy])).toEqual({ primary: fn, others: [role, policy] });
  });

  test('a default child breaks a tie at the shallowest depth', () => {
    // A Vpc creates its CfnVPC (the `Resource` default child) and an
    // InternetGateway as siblings at the same depth.
    const vpc = res('S/Vpc/Resource', 'Vpc1', 'AWS::EC2::VPC');
    const igw = res('S/Vpc/IGW', 'Igw1', 'AWS::EC2::InternetGateway');

    expect(selectPrimary([igw, vpc])).toEqual({ primary: vpc, others: [igw] });
  });

  test('a tie at the shallowest depth with no default child has no primary', () => {
    const lb = res('S/Svc/LB/Resource', 'Lb1', 'AWS::ElasticLoadBalancingV2::LoadBalancer');
    const task = res('S/Svc/Task/Resource', 'Task1', 'AWS::ECS::TaskDefinition');

    expect(selectPrimary([lb, task])).toBeUndefined();
  });

  test('two default children tied at the shallowest depth have no primary', () => {
    const a = res('S/A/Resource', 'A1', 'AWS::S3::Bucket');
    const b = res('S/B/Resource', 'B1', 'AWS::SQS::Queue');

    expect(selectPrimary([a, b])).toBeUndefined();
  });
});

describe('buildHover', () => {
  const links: HoverLinks = {
    resourceLocations: {
      'S/Fn/Resource': { uri: LINK_URI, line: 5 },
      'S/Fn/ServiceRole/Resource': { uri: LINK_URI, line: 40 },
    },
    // resolveHoverLinks keys properties by lower-cased name.
    properties: { runtime: { uri: LINK_URI, line: 8 } },
  };

  test('returns undefined when no resource maps to the line', () => {
    expect(buildHover([], undefined, links, RANGE)).toBeUndefined();
  });

  test('links the logical id to its block and each value to its property line', () => {
    const fn = res('S/Fn/Resource', 'Fn1', 'AWS::Lambda::Function', { runtime: 'nodejs16.x' });

    const text = hoverText([fn], links);

    expect(text).toContain(`[**Fn1**](${LINK_URI}#L5) · \`AWS::Lambda::Function\``);
    expect(text).toContain('`S/Fn/Resource`');
    expect(text).toContain(`- \`runtime\`: [\`"nodejs16.x"\`](${LINK_URI}#L8)`);
  });

  test('renders a value without a link when none resolved for it', () => {
    const fn = res('S/Fn/Resource', 'Fn1', 'AWS::Lambda::Function', { memorySize: 512 });

    const text = hoverText([fn], links);

    expect(text).toContain('- `memorySize`: `512`');
    expect(text).not.toContain('memorySize`]');
  });

  test('renders everything plainly when links are absent', () => {
    const fn = res('S/Fn/Resource', 'Fn1', 'AWS::Lambda::Function', { runtime: 'nodejs16.x' });

    const text = hoverText([fn]);

    expect(text).toContain('**Fn1** · `AWS::Lambda::Function`');
    expect(text).not.toContain('](');
  });

  test('caps the property list and reports the remainder', () => {
    const cfnProperties = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`p${i}`, i]));

    const text = hoverText([res('S/Fn/Resource', 'Fn1', 'AWS::Lambda::Function', cfnProperties)]);

    expect(text).toContain('- `p11`: `11`');
    expect(text).not.toContain('- `p12`:');
    expect(text).toContain('- +3 more');
  });

  test('shows only the primary properties and lists the rest under Also creates', () => {
    const fn = res('S/Fn/Resource', 'Fn1', 'AWS::Lambda::Function', { runtime: 'nodejs16.x' });
    const role = res('S/Fn/ServiceRole/Resource', 'Role1', 'AWS::IAM::Role', { roleName: 'x' });

    const text = hoverText([fn, role], links);

    expect(text).toContain('- `runtime`:');
    expect(text).not.toContain('roleName');
    expect(text).toContain(`Also creates: [\`AWS::IAM::Role\`](${LINK_URI}#L40)`);
  });

  test('collapses a large auxiliary set into a type histogram', () => {
    const vpc = res('S/Vpc/Resource', 'Vpc1', 'AWS::EC2::VPC');
    const aux = [
      ...Array.from({ length: 3 }, (_, i) => res(`S/Vpc/S${i}/Subnet`, `S${i}`, 'AWS::EC2::Subnet')),
      ...Array.from({ length: 2 }, (_, i) => res(`S/Vpc/R${i}/RouteTable`, `R${i}`, 'AWS::EC2::RouteTable')),
      res('S/Vpc/Igw/Resource', 'Igw1', 'AWS::EC2::InternetGateway'),
    ];

    const text = hoverText([vpc, ...aux]);

    expect(text).toContain('Also creates 6 resources:');
    expect(text).toContain('3× Subnet');
    expect(text).toContain('2× RouteTable');
  });

  test('shows a plain summary when several resources tie with no primary', () => {
    const lb = res('S/Svc/LB/Resource', 'Lb1', 'AWS::ElasticLoadBalancingV2::LoadBalancer');
    const task = res('S/Svc/Task/Resource', 'Task1', 'AWS::ECS::TaskDefinition');

    const text = hoverText([lb, task]);

    expect(text).toContain('**2 resources on this line**');
    expect(text).not.toContain('Also creates');
  });
});

describe('resourceNodesOnLine', () => {
  async function indexWith(spec: AssemblySpec) {
    fixture = AssemblyFixture.create({ sourceFiles: SOURCE, ...spec });
    return fixture.index();
  }

  test('returns only the resources on the hovered file and line', async () => {
    const index = await indexWith({
      stacks: [{
        id: 'S',
        resources: [
          { path: 'Fn/Resource', logicalId: 'Fn1', type: 'AWS::Lambda::Function', at: 'lib/app.ts:10:3' },
          { path: 'Other/Resource', logicalId: 'Ot1', type: 'AWS::S3::Bucket', at: 'lib/app.ts:20:3' },
          { path: 'Elsewhere/Resource', logicalId: 'El1', type: 'AWS::S3::Bucket', at: 'lib/other.ts:10:3' },
        ],
      }],
    });

    // LSP line 9 is 1-based line 10.
    const found = resourceNodesOnLine(index, fixture!.sourcePath('lib/app.ts'), { line: 9, character: 0 });

    expect(found.map((n) => n.cfnResource.logicalId)).toEqual(['Fn1']);
  });

  test('excludes a wrapper construct that is not a CFN resource', async () => {
    const index = await indexWith({
      withoutTree: true,
      stacks: [{ id: 'S', resources: [{ path: 'Wrapper', logicalId: 'W1', at: 'lib/app.ts:10:1' }] }],
    });

    expect(resourceNodesOnLine(index, fixture!.sourcePath('lib/app.ts'), { line: 9, character: 0 })).toEqual([]);
  });

  test('returns an empty list for a line with nothing on it', async () => {
    const index = await indexWith({
      stacks: [{ id: 'S', resources: [{ path: 'Fn/Resource', logicalId: 'Fn1', type: 'AWS::Lambda::Function', at: 'lib/app.ts:10:3' }] }],
    });

    expect(resourceNodesOnLine(index, fixture!.sourcePath('lib/app.ts'), { line: 98, character: 0 })).toEqual([]);
  });
});

describe('hoverForPosition', () => {
  test('resolves block and per-property links from the real template', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: SOURCE,
      stacks: [{
        id: 'S',
        resources: [{
          path: 'Fn/Resource',
          logicalId: 'Fn1',
          type: 'AWS::Lambda::Function',
          at: 'lib/app.ts:10:3',
          props: { Runtime: 'nodejs16.x' },
        }],
      }],
    });
    const index = await fixture.index();

    const hover = await hoverForPosition(makeLog(), index, fixture.sourcePath('lib/app.ts'), { line: 9, character: 0 },
      async (file) => fixture!.templateText(file.replace(/\.template\.json$/, '')));
    const text = (hover!.contents as { value: string }).value;

    // Both links point into the assembly's template, at resolved lines.
    expect(text).toMatch(/\[\*\*Fn1\*\*\]\(file:.*S\.template\.json#L\d+\) · `AWS::Lambda::Function`/);
    expect(text).toMatch(/- `Runtime`: \[`"nodejs16\.x"`\]\(file:.*S\.template\.json#L\d+\)/);
  });

  test('links to a URI inside the assembly dir, not relative to the process cwd', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: SOURCE,
      stacks: [{ id: 'S', resources: [{ path: 'Fn/Resource', logicalId: 'Fn1', type: 'AWS::Lambda::Function', at: 'lib/app.ts:10:3' }] }],
    });
    const index = await fixture.index();

    const hover = await hoverForPosition(makeLog(), index, fixture.sourcePath('lib/app.ts'), { line: 9, character: 0 },
      async () => fixture!.templateText('S'));
    const text = (hover!.contents as { value: string }).value;

    expect(text).toContain(fixture.assemblyDir);
  });

  test('renders without links and reports when the template read fails', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: SOURCE,
      stacks: [{ id: 'S', resources: [{ path: 'Fn/Resource', logicalId: 'Fn1', type: 'AWS::Lambda::Function', at: 'lib/app.ts:10:3' }] }],
    });
    const index = await fixture.index();
    const log = makeLog();

    // The seam throws rather than returning undefined, so the failure is a real
    // error the user can be told about instead of silently losing the links.
    const hover = await hoverForPosition(log, index, fixture.sourcePath('lib/app.ts'), { line: 9, character: 0 },
      async () => {
        throw new Error('ENOENT');
      });
    const text = (hover!.contents as { value: string }).value;

    expect(text).toContain('**Fn1** · `AWS::Lambda::Function`');
    expect(text).not.toContain('](');
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('S.template.json'));
  });

  test('keeps linking the resources whose templates do read', async () => {
    // One bad template must not cost the other resources their links.
    fixture = AssemblyFixture.create({
      sourceFiles: SOURCE,
      stacks: [{
        id: 'S',
        resources: [
          { path: 'Fn/Resource', logicalId: 'Fn1', type: 'AWS::Lambda::Function', at: 'lib/app.ts:10:3' },
          { path: 'Fn/Role/Resource', logicalId: 'Role1', type: 'AWS::IAM::Role', at: 'lib/app.ts:10:3' },
        ],
      }],
    });
    const index = await fixture.index();
    let call = 0;
    const log = makeLog();

    const hover = await hoverForPosition(log, index, fixture.sourcePath('lib/app.ts'), { line: 9, character: 0 },
      async (file) => {
        call += 1;
        if (call === 1) throw new Error('ENOENT');
        return fixture!.templateText('S');
      });
    const text = (hover!.contents as { value: string }).value;

    // The primary's own read failed, but the auxiliary still resolved a link.
    expect(text).toContain('Also creates: [`AWS::IAM::Role`]');
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  test('returns undefined when no resource is on the hovered line', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: SOURCE,
      stacks: [{ id: 'S', resources: [{ path: 'Fn/Resource', logicalId: 'Fn1', type: 'AWS::Lambda::Function', at: 'lib/app.ts:10:3' }] }],
    });
    const index = await fixture.index();

    expect(await hoverForPosition(makeLog(), index, fixture.sourcePath('lib/app.ts'), { line: 98, character: 0 }, async () => '')).toBeUndefined();
  });

  test('reads each referenced template only once for a multi-resource line', async () => {
    // A VPC-like fan-out: every resource lives in the same template, so the
    // hover must not re-read it per resource.
    fixture = AssemblyFixture.create({
      sourceFiles: SOURCE,
      stacks: [{
        id: 'S',
        resources: [
          { path: 'Vpc/Resource', logicalId: 'Vpc1', type: 'AWS::EC2::VPC', at: 'lib/app.ts:10:3' },
          { path: 'Vpc/Subnet1/Resource', logicalId: 'Sub1', type: 'AWS::EC2::Subnet', at: 'lib/app.ts:10:3' },
          { path: 'Vpc/Subnet2/Resource', logicalId: 'Sub2', type: 'AWS::EC2::Subnet', at: 'lib/app.ts:10:3' },
        ],
      }],
    });
    const index = await fixture.index();
    const readTemplate = jest.fn(async () => fixture!.templateText('S'));

    await hoverForPosition(makeLog(), index, fixture.sourcePath('lib/app.ts'), { line: 9, character: 0 }, readTemplate);

    expect(readTemplate).toHaveBeenCalledTimes(1);
  });
});
