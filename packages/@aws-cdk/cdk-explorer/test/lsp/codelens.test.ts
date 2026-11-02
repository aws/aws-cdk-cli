import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { codeLensesForFile, OPEN_RESOURCE_COMMAND } from '../../lib/lsp/codelens';
import { COMMAND_SYNTH_NOW, COMMAND_ENABLE_AUTO_SYNTH, COMMAND_DISABLE_AUTO_SYNTH } from '../../lib/lsp/commands';
import { AssemblyFixture, type AssemblySpec } from '../_helpers/assembly';

/** Shape of one resource choice carried in the openResource command arguments. */
interface CommandChoice {
  label: string;
  description: string;
  target: { uri: string; range: { start: unknown; end: unknown } };
}

let fixture: AssemblyFixture | undefined;

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

const SOURCE = { 'lib/stack.ts': '\n'.repeat(40), 'lib/other.ts': '\n'.repeat(40) };

async function lensesFor(spec: AssemblySpec, relPath = 'lib/stack.ts', autoSynth = false) {
  fixture = AssemblyFixture.create({ sourceFiles: SOURCE, ...spec });
  const index = await fixture.index();
  return codeLensesForFile(index, fixture.assemblyDir, fixture.sourcePath(relPath), autoSynth);
}

/** The two or three commands that only ever appear on the line-0 header lenses. */
const HEADER_COMMANDS: string[] = [COMMAND_SYNTH_NOW, COMMAND_ENABLE_AUTO_SYNTH, COMMAND_DISABLE_AUTO_SYNTH];

/** The resource lenses, i.e. everything that is not a header lens. */
function resourceLenses(lenses: Awaited<ReturnType<typeof lensesFor>>) {
  return lenses.filter((l) => !HEADER_COMMANDS.includes(l.command?.command ?? ''));
}

function choicesOf(lens: { command?: { arguments?: unknown[] } }): CommandChoice[] {
  return (lens.command!.arguments as CommandChoice[][])[0];
}

describe('codeLensesForFile', () => {
  test('returns no lenses when the assembly is empty', async () => {
    expect(await lensesFor({})).toEqual([]);
  });

  test('returns no lenses for a file with no constructs', async () => {
    const lenses = await lensesFor({
      stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' }] }],
    }, 'lib/other.ts');

    // No header lenses either: a file with nothing CDK in it stays clean.
    expect(lenses).toEqual([]);
  });

  test('returns no lenses for a construct that is not a CFN resource', async () => {
    // An L2 wrapper carries a source location but no logical id or CFN type;
    // those live on its Resource child. Wrappers get no lens of their own.
    const lenses = await lensesFor({
      withoutTree: true,
      stacks: [{ id: 'S', resources: [{ path: 'MyBucket', logicalId: 'Wrapper', at: 'lib/stack.ts:12:5' }] }],
    });

    expect(lenses).toEqual([]);
  });

  test('omits constructs with no creation stack (non-TypeScript app)', async () => {
    const lenses = await lensesFor({
      stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket' }] }],
    });

    expect(lenses).toEqual([]);
  });

  test('emits one lens on the creation line of a resource', async () => {
    const lenses = await lensesFor({
      stacks: [{ id: 'S', resources: [{ path: 'MyBucket/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' }] }],
    });

    const [lens] = resourceLenses(lenses);
    // 1-based source line to 0-based LSP line; the lens renders above it.
    expect(lens.range).toEqual({ start: { line: 11, character: 0 }, end: { line: 11, character: 0 } });
    expect(lens.command?.title).toBe('Creates AWS::S3::Bucket');
  });

  test('groups several resources on one line into a single lens', async () => {
    // An L2 Bucket fans out into a bucket, its policy and a key, all anchored to
    // the same `new s3.Bucket(...)` line.
    const lenses = await lensesFor({
      stacks: [{
        id: 'S',
        resources: [
          { path: 'MyBucket/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' },
          { path: 'MyBucket/Policy/Resource', logicalId: 'P1', type: 'AWS::S3::BucketPolicy', at: 'lib/stack.ts:12:5' },
          { path: 'MyBucket/Key/Resource', logicalId: 'K1', type: 'AWS::KMS::Key', at: 'lib/stack.ts:12:5' },
        ],
      }],
    });

    const lenses0 = resourceLenses(lenses);
    expect(lenses0).toHaveLength(1);
    // The title histograms the short CFN type names, most common type first.
    expect(lenses0[0].command?.title).toBe('Creates 3 resources: 1× Bucket, 1× BucketPolicy, 1× Key');
  });

  test('emits separate lenses for resources on different lines', async () => {
    const lenses = await lensesFor({
      stacks: [{
        id: 'S',
        resources: [
          { path: 'A/Resource', logicalId: 'A1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:10:1' },
          { path: 'B/Resource', logicalId: 'B1', type: 'AWS::SQS::Queue', at: 'lib/stack.ts:20:1' },
        ],
      }],
    });

    expect(resourceLenses(lenses).map((l) => l.range.start.line).sort((a, b) => a - b)).toEqual([9, 19]);
  });

  test('selects by file, so each file shows only its own resources', async () => {
    const spec: AssemblySpec = {
      stacks: [{
        id: 'S',
        resources: [
          { path: 'A/Resource', logicalId: 'A1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:10:1' },
          { path: 'B/Resource', logicalId: 'B1', type: 'AWS::SQS::Queue', at: 'lib/other.ts:5:1' },
        ],
      }],
    };

    const onStack = resourceLenses(await lensesFor(spec, 'lib/stack.ts'));
    expect(onStack).toHaveLength(1);
    expect(onStack[0].command?.title).toBe('Creates AWS::S3::Bucket');

    const onOther = resourceLenses(await lensesFor(spec, 'lib/other.ts'));
    expect(onOther).toHaveLength(1);
    expect(onOther[0].command?.title).toBe('Creates AWS::SQS::Queue');
  });

  test('finds resources nested deep under wrapper constructs', async () => {
    const lenses = await lensesFor({
      stacks: [{ id: 'S', resources: [{ path: 'Outer/Middle/MyBucket/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' }] }],
    });

    expect(resourceLenses(lenses)[0].command?.title).toContain('AWS::S3::Bucket');
  });

  test('accepts the absolute path the language server hands it', async () => {
    // The server only knows the document's absolute path; the lens builder must
    // translate it to the app-relative key the index is built on.
    fixture = AssemblyFixture.create({
      sourceFiles: SOURCE,
      stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' }] }],
    });
    const index = await fixture.index();

    const absolute = await codeLensesForFile(index, fixture.assemblyDir, fixture.sourcePath('lib/stack.ts'), false);

    expect(resourceLenses(absolute)).toHaveLength(1);
  });
});

describe('codeLensesForFile openResource command', () => {
  test('a resolvable resource becomes a clickable single choice', async () => {
    const lenses = await lensesFor({
      stacks: [{ id: 'S', resources: [{ path: 'MyBucket/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' }] }],
    });

    const [lens] = resourceLenses(lenses);
    expect(lens.command?.command).toBe(OPEN_RESOURCE_COMMAND);
    const choices = choicesOf(lens);
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({
      label: 'AWS::S3::Bucket',
      // The synthetic Resource leaf is stripped for display.
      description: 'S/MyBucket',
      target: { uri: pathToFileURL(fixture!.templatePath('S')).toString() },
    });
    // A real span, not zero-width; exact offsets are template-locator's business.
    expect(choices[0].target.range.start).not.toEqual(choices[0].target.range.end);
  });

  test('a multi-resource line carries every resolvable resource as a choice', async () => {
    const lenses = await lensesFor({
      stacks: [{
        id: 'S',
        resources: [
          { path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' },
          { path: 'B/Policy/Resource', logicalId: 'B2', type: 'AWS::S3::BucketPolicy', at: 'lib/stack.ts:12:5' },
        ],
      }],
    });

    const choices = choicesOf(resourceLenses(lenses)[0]);
    const uri = pathToFileURL(fixture!.templatePath('S')).toString();
    expect(choices).toMatchObject([
      { label: 'AWS::S3::Bucket', description: 'S/B', target: { uri } },
      { label: 'AWS::S3::BucketPolicy', description: 'S/B/Policy', target: { uri } },
    ]);
    // Each resolves to its own block.
    expect(choices[0].target.range).not.toEqual(choices[1].target.range);
  });

  test('stays title-only when the template cannot be read', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: SOURCE,
      stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' }] }],
    });
    const index = await fixture.index();
    fs.rmSync(fixture.templatePath('S'));

    const [lens] = resourceLenses(await codeLensesForFile(index, fixture.assemblyDir, fixture.sourcePath('lib/stack.ts'), false));

    // The title still tells you what is created, it just is not navigable.
    expect(lens.command?.title).toBe('Creates AWS::S3::Bucket');
    expect(lens.command?.command).toBe('');
    expect(lens.command?.arguments).toBeUndefined();
  });

  test('stays title-only when the logical id is missing from the template', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: SOURCE,
      stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' }] }],
    });
    const index = await fixture.index();
    fs.writeFileSync(fixture.templatePath('S'), JSON.stringify({ Resources: { SomethingElse: { Type: 'AWS::S3::Bucket' } } }, undefined, 1));

    const [lens] = resourceLenses(await codeLensesForFile(index, fixture.assemblyDir, fixture.sourcePath('lib/stack.ts'), false));

    expect(lens.command?.command).toBe('');
  });

  test('drops only the unresolvable resources from a mixed line', async () => {
    fixture = AssemblyFixture.create({
      sourceFiles: SOURCE,
      stacks: [{
        id: 'S',
        resources: [
          { path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' },
          { path: 'B/Policy/Resource', logicalId: 'B2', type: 'AWS::S3::BucketPolicy', at: 'lib/stack.ts:12:5' },
        ],
      }],
    });
    const index = await fixture.index();
    // Remove just one of the two resources from the template.
    fs.writeFileSync(fixture.templatePath('S'), JSON.stringify({ Resources: { B1: { Type: 'AWS::S3::Bucket' } } }, undefined, 1));

    const [lens] = resourceLenses(await codeLensesForFile(index, fixture.assemblyDir, fixture.sourcePath('lib/stack.ts'), false));

    // Title still reports both; only the resolvable one is clickable.
    expect(lens.command?.title).toBe('Creates 2 resources: 1× Bucket, 1× BucketPolicy');
    expect(choicesOf(lens).map((c) => c.label)).toEqual(['AWS::S3::Bucket']);
  });
});

describe('codeLensesForFile header lenses', () => {
  const spec: AssemblySpec = {
    stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' }] }],
  };

  test('offers synth-now and enable when auto-synth is off', async () => {
    const lenses = await lensesFor(spec, 'lib/stack.ts', false);

    expect(lenses[0].range.start.line).toBe(0);
    expect(lenses[0].command?.command).toBe(COMMAND_SYNTH_NOW);
    expect(lenses[1].command?.command).toBe(COMMAND_ENABLE_AUTO_SYNTH);
  });

  test('offers only disable when auto-synth is on', async () => {
    // Saves already trigger a synth, so "Synth now" would be noise.
    const lenses = await lensesFor(spec, 'lib/stack.ts', true);

    expect(lenses).toHaveLength(2); // 1 header + 1 resource
    expect(lenses[0].command?.command).toBe(COMMAND_DISABLE_AUTO_SYNTH);
  });
});
