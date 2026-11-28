import { AssemblyIndex, CloudAssembly, ENTIRE_TEMPLATE_LOGICALID_MARKER, loadUnifiedValidationReport } from '../lib';
import { rimraf, writeFiles } from './util';

/**
 * Deliberately non-default tree filename, so every test here also proves the
 * name is read from the manifest's `cdk:tree` artifact rather than assumed.
 */
const TREE_FILE = 'foo.tree.json';

let dir: string | undefined;

afterEach(() => {
  if (dir) rimraf(dir);
  dir = undefined;
});

/** Shorthand for a tree.json node. */
function treeNode(id: string, nodePath: string, extra: Record<string, unknown> = {}) {
  return { id, path: nodePath, ...extra };
}

/** `cfnResource.type` attribute as emitted by aws-cdk-lib into tree.json. */
function cfnType(type: string) {
  return { attributes: { 'aws:cdk:cloudformation:type': type } };
}

async function indexOf(assemblyDir: string): Promise<AssemblyIndex> {
  return AssemblyIndex.fromAssembly(new CloudAssembly(assemblyDir));
}

/**
 * A single-stack assembly: stack `S` with an L2 `Bucket` wrapping an L1
 * `Resource`, plus the internal `CDKMetadata` node every real app carries.
 */
function singleStackAssembly(opts: { withTree?: boolean; propertyMutations?: { propertyName: string; stackTrace: string[] }[] } = {}): string {
  const withTree = opts.withTree ?? true;
  return writeFiles({
    'manifest.json': {
      version: '0.0.0',
      artifacts: {
        S: {
          type: 'aws:cloudformation:stack',
          environment: 'aws://111/us-east-1',
          properties: { templateFile: 'S.template.json' },
          metadata: {
            '/S/Bucket/Resource': [
              { type: 'aws:cdk:logicalId', data: 'BucketABC' },
              ...(opts.propertyMutations ?? []).map((data) => ({ type: 'aws:cdk:propertyAssignment', data })),
            ],
            '/S/CDKMetadata/Default': [{ type: 'aws:cdk:logicalId', data: 'CDKMetadata' }],
          },
        },
        ...(withTree ? { Tree: { type: 'cdk:tree', properties: { file: TREE_FILE } } } : {}),
      },
    },
    'S.template.json': { Resources: { BucketABC: { Type: 'AWS::S3::Bucket' } } },
    ...(withTree ? {
      [TREE_FILE]: {
        version: 'tree-0.1',
        tree: treeNode('App', '', {
          children: {
            S: treeNode('S', 'S', {
              children: {
                Bucket: treeNode('Bucket', 'S/Bucket', {
                  children: {
                    Resource: treeNode('Resource', 'S/Bucket/Resource', {
                      attributes: {
                        'aws:cdk:cloudformation:type': 'AWS::S3::Bucket',
                        'aws:cdk:cloudformation:props': { BucketName: 'my-bucket' },
                      },
                      constructInfo: { fqn: 'aws-cdk-lib.aws_s3.CfnBucket', version: '2.1.0' },
                    }),
                  },
                }),
                CDKMetadata: treeNode('CDKMetadata', 'S/CDKMetadata'),
              },
            }),
            // aws-cdk-lib emits a `Tree` construct for the tree artifact itself.
            Tree: treeNode('Tree', 'Tree'),
          },
        }),
      },
    } : {}),
  });
}

describe('property mutation stacks', () => {
  test.each([true, false])('indexes mutation sites with tree.json present: %s', async (withTree) => {
    dir = singleStackAssembly({
      withTree,
      propertyMutations: [
        { propertyName: 'Tags', stackTrace: ['at addTag (app.ts:10:3)', 'at main (app.ts:20:1)'] },
        { propertyName: 'BucketName', stackTrace: ['at main (app.ts:8:1)'] },
        { propertyName: 'Tags', stackTrace: ['at addTag (app.ts:11:3)'] },
      ],
    });
    const index = await indexOf(dir);
    const node = index.byPath('/S/Bucket/Resource')!;

    expect(node.propertyMutationStacks).toEqual({
      Tags: [['at addTag (app.ts:10:3)', 'at main (app.ts:20:1)'], ['at addTag (app.ts:11:3)']],
      BucketName: [['at main (app.ts:8:1)']],
    });
    expect(index.byTemplateLocation('S.template.json', 'BucketABC')).toBe(node);
    expect(index.byPath('S/Bucket')!.propertyMutationStacks).toBeUndefined();
  });

  test('leaves mutation stacks absent when debug metadata is unavailable', async () => {
    dir = singleStackAssembly();
    expect((await indexOf(dir)).byPath('S/Bucket/Resource')!.propertyMutationStacks).toBeUndefined();
  });

  test('preserves repeated and empty traces and handles property names matching object members', async () => {
    dir = singleStackAssembly({
      propertyMutations: [
        { propertyName: 'Tags', stackTrace: ['at main (app.ts:10:1)'] },
        { propertyName: 'Tags', stackTrace: ['at main (app.ts:10:1)'] },
        { propertyName: '__proto__', stackTrace: [] },
        { propertyName: 'constructor', stackTrace: ['at main (app.ts:12:1)'] },
      ],
    });
    const mutations = (await indexOf(dir)).byPath('S/Bucket/Resource')!.propertyMutationStacks!;
    expect(mutations.Tags).toEqual([['at main (app.ts:10:1)'], ['at main (app.ts:10:1)']]);
    expect(mutations.__proto__).toEqual([[]]);
    expect(mutations.constructor).toEqual([['at main (app.ts:12:1)']]);
  });
});

describe('tree.json loading', () => {
  test('joins tree.json attributes with manifest metadata onto one node', async () => {
    dir = singleStackAssembly();
    const node = (await indexOf(dir)).byPath('S/Bucket/Resource')!;

    expect(node).toMatchObject({
      constructPath: 'S/Bucket/Resource',
      id: 'Resource',
      cfnResource: {
        type: 'AWS::S3::Bucket',
        logicalId: 'BucketABC',
        cfnProperties: { BucketName: 'my-bucket' },
        assemblyRelativeTemplateFile: 'S.template.json',
      },
      constructInfo: { fqn: 'aws-cdk-lib.aws_s3.CfnBucket', version: '2.1.0' },
    });
  });

  test('an L2 wrapper node carries no CFN resource data', async () => {
    dir = singleStackAssembly();
    expect((await indexOf(dir)).byPath('S/Bucket')!.cfnResource).toEqual({});
  });

  test('prunes the internal Tree and <stack>/CDKMetadata nodes', async () => {
    dir = singleStackAssembly();
    const index = await indexOf(dir);

    expect(index.byPath('Tree')).toBeUndefined();
    expect(index.byPath('S/CDKMetadata')).toBeUndefined();
    expect(index.firstLevelChildren.map((n) => n.id)).toEqual(['S']);
  });

  test('root is the synthetic app node holding the first level as children', async () => {
    dir = singleStackAssembly();
    const index = await indexOf(dir);

    expect(index.root.constructPath).toBe('');
    expect(Object.values(index.root.children)).toEqual(index.firstLevelChildren);
  });

  test('an assembly with no tree artifact still indexes constructs from metadata alone', async () => {
    dir = singleStackAssembly({ withTree: false });
    const node = (await indexOf(dir)).byPath('S/Bucket/Resource')!;

    // No tree.json means no CFN type, but the metadata join still places the node.
    expect(node.cfnResource).toEqual({ logicalId: 'BucketABC', assemblyRelativeTemplateFile: 'S.template.json' });
    expect(node.cfnResource.type).toBeUndefined();
  });

  test('expands a subtree reference against the tree file\'s own directory', async () => {
    dir = writeFiles({
      'manifest.json': { version: '0.0.0', artifacts: { Tree: { type: 'cdk:tree', properties: { file: `trees/${TREE_FILE}` } } } },
      [`trees/${TREE_FILE}`]: {
        version: 'tree-0.1',
        tree: treeNode('App', '', { children: { S: { id: 'S', path: 'S', fileName: 'forest.json', treeId: 'sub1' } } }),
      },
      // Sibling of the tree file, NOT of the assembly root: proves the join uses dirname(treePath).
      'trees/forest.json': {
        version: 'forest-0.1',
        forest: { sub1: treeNode('S', 'S', { children: { Inner: treeNode('Inner', 'S/Inner', cfnType('AWS::S3::Bucket')) } }) },
      },
    });

    expect((await indexOf(dir)).byPath('S/Inner')!.cfnResource.type).toBe('AWS::S3::Bucket');
  });

  test('a subtree reference to a missing treeId degrades to a placeholder, not a crash', async () => {
    dir = writeFiles({
      'manifest.json': { version: '0.0.0', artifacts: { Tree: { type: 'cdk:tree', properties: { file: TREE_FILE } } } },
      [TREE_FILE]: {
        version: 'tree-0.1',
        tree: treeNode('App', '', { children: { S: { id: 'S', path: 'S', fileName: 'forest.json', treeId: 'absent' } } }),
      },
      'forest.json': { version: 'forest-0.1', forest: {} },
    });

    const children = (await indexOf(dir)).firstLevelChildren;

    // The dangling reference yields an empty placeholder rather than throwing;
    // it contributes no constructs for callers to walk into.
    expect(children).toHaveLength(1);
    expect(children[0].children).toEqual({});
    expect(children[0].cfnResource.type).toBeUndefined();
  });
});

describe('byPath', () => {
  test('resolves nested paths and tolerates a leading slash', async () => {
    dir = singleStackAssembly();
    const index = await indexOf(dir);

    expect(index.byPath('S/Bucket/Resource')!.id).toBe('Resource');
    // Metadata keys are stored with a leading slash, so both forms must resolve.
    expect(index.byPath('/S/Bucket/Resource')!.constructPath).toBe('S/Bucket/Resource');
  });

  test('returns undefined for an unknown path', async () => {
    dir = singleStackAssembly();
    expect((await indexOf(dir)).byPath('S/Nope/Resource')).toBeUndefined();
  });
});

describe('creation stack', () => {
  /** Stack whose metadata exercises each way a creation stack can arrive. */
  function creationStackAssembly(): string {
    return writeFiles({
      'manifest.json': {
        version: '0.0.0',
        artifacts: {
          S: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://111/us-east-1',
            properties: { templateFile: 'S.template.json' },
            metadata: {
              '/S/Both/Resource': [
                { type: 'aws:cdk:creationStack', data: ['fromCreationStack'] },
                { type: 'aws:cdk:logicalId', data: 'Both1', trace: ['fromTrace'] },
              ],
              '/S/TraceOnly/Resource': [{ type: 'aws:cdk:logicalId', data: 'Trace1', trace: ['fromTrace'] }],
              '/S/Neither/Resource': [{ type: 'aws:cdk:logicalId', data: 'Neither1' }],
            },
          },
        },
      },
      'S.template.json': { Resources: {} },
    });
  }

  test('a dedicated creationStack entry wins over the logicalId entry trace', async () => {
    dir = creationStackAssembly();
    expect((await indexOf(dir)).byPath('S/Both/Resource')!.creationStack).toEqual(['fromCreationStack']);
  });

  test('falls back to the logicalId entry trace', async () => {
    dir = creationStackAssembly();
    expect((await indexOf(dir)).byPath('S/TraceOnly/Resource')!.creationStack).toEqual(['fromTrace']);
  });

  test('is undefined when metadata carries neither', async () => {
    dir = creationStackAssembly();
    expect((await indexOf(dir)).byPath('S/Neither/Resource')!.creationStack).toBeUndefined();
  });
});

describe('nested stacks', () => {
  /**
   * Emits the real aws-cdk-lib NestedStack topology: the resources live under
   * `S/N`, while the `AWS::CloudFormation::Stack` that produces the nested
   * template sits at the sibling `S/N.NestedStack/N.NestedStackResource` and
   * carries the `aws:asset:path` pointing at it.
   */
  function nestedStackAssembly(opts: { assetPath?: string | false; writeNested?: boolean; nestedLogicalId?: string } = {}): string {
    const assetPath = opts.assetPath === undefined ? 'SNInner.nested.template.json' : opts.assetPath;
    const nestedLogicalId = opts.nestedLogicalId ?? 'NestedQueue';
    const writeNested = opts.writeNested ?? true;

    return writeFiles({
      'manifest.json': {
        version: '0.0.0',
        artifacts: {
          S: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://111/us-east-1',
            properties: { templateFile: 'S.template.json' },
            metadata: {
              '/S/TopBucket/Resource': [{ type: 'aws:cdk:logicalId', data: 'TopBucket' }],
              '/S/N/Queue/Resource': [
                { type: 'aws:cdk:logicalId', data: nestedLogicalId },
                { type: 'aws:cdk:propertyAssignment', data: { propertyName: 'VisibilityTimeout', stackTrace: ['nestedMutation'] } },
              ],
              '/S/N.NestedStack/N.NestedStackResource': [{ type: 'aws:cdk:logicalId', data: 'NNestedStackRes' }],
            },
          },
        },
      },
      'S.template.json': {
        Resources: {
          TopBucket: { Type: 'AWS::S3::Bucket' },
          NNestedStackRes: {
            Type: 'AWS::CloudFormation::Stack',
            Metadata: {
              'aws:cdk:path': 'S/N.NestedStack/N.NestedStackResource',
              ...(assetPath === false ? {} : { 'aws:asset:path': assetPath }),
            },
          },
        },
      },
      ...(writeNested ? { 'SNInner.nested.template.json': { Resources: { [nestedLogicalId]: { Type: 'AWS::SQS::Queue' } } } } : {}),
    });
  }

  test('routes parent and nested resources to their own templates', async () => {
    dir = nestedStackAssembly();
    const index = await indexOf(dir);

    expect(index.byPath('S/TopBucket/Resource')!.cfnResource.assemblyRelativeTemplateFile).toBe('S.template.json');
    expect(index.byPath('S/N/Queue/Resource')!.cfnResource.assemblyRelativeTemplateFile).toBe('SNInner.nested.template.json');
  });

  test('exposes nested resource mutation sites through template lookup', async () => {
    dir = nestedStackAssembly();
    const index = await indexOf(dir);
    expect(index.byTemplateLocation('SNInner.nested.template.json', 'NestedQueue')!.propertyMutationStacks)
      .toEqual({ VisibilityTimeout: [['nestedMutation']] });
    expect(index.byTemplateLocation('S.template.json', 'TopBucket')!.propertyMutationStacks).toBeUndefined();
  });

  test('routes twins that share a logical id to their own templates', async () => {
    // A NestedStack resets the logical-ID namespace, so the parent bucket and the
    // nested queue can both be "TopBucket"; scope must disambiguate, not the id.
    dir = nestedStackAssembly({ nestedLogicalId: 'TopBucket' });
    const index = await indexOf(dir);

    expect(index.byPath('S/TopBucket/Resource')!.cfnResource.assemblyRelativeTemplateFile).toBe('S.template.json');
    expect(index.byPath('S/N/Queue/Resource')!.cfnResource.assemblyRelativeTemplateFile).toBe('SNInner.nested.template.json');
  });

  test('still scopes the subtree when the nested template file is missing', async () => {
    // The template is unreadable, so its own resources can't be scanned, but the
    // asset path alone is enough to scope the subtree.
    dir = nestedStackAssembly({ writeNested: false });
    const index = await indexOf(dir);

    expect(index.byPath('S/N/Queue/Resource')!.cfnResource.assemblyRelativeTemplateFile).toBe('SNInner.nested.template.json');
    expect(index.byPath('S/TopBucket/Resource')!.cfnResource.assemblyRelativeTemplateFile).toBe('S.template.json');
  });

  test('falls back to the parent template without asset metadata (--no-asset-metadata)', async () => {
    dir = nestedStackAssembly({ assetPath: false });
    expect((await indexOf(dir)).byPath('S/N/Queue/Resource')!.cfnResource.assemblyRelativeTemplateFile).toBe('S.template.json');
  });

  describe('whole-template marker', () => {
    // A construct that *produces* a template (a stack, or a NestedStack) is handed
    // the marker as its logical ID, so callers can treat "jump to this template"
    // with the same code path as "jump to this resource".

    test('a stack produces its own template', async () => {
      dir = nestedStackAssembly();

      expect((await indexOf(dir)).byPath('S')!.cfnResource).toMatchObject({
        logicalId: ENTIRE_TEMPLATE_LOGICALID_MARKER,
        assemblyRelativeTemplateFile: 'S.template.json',
      });
    });

    test('a nested stack produces the nested template', async () => {
      dir = nestedStackAssembly();

      expect((await indexOf(dir)).byPath('S/N')!.cfnResource).toMatchObject({
        logicalId: ENTIRE_TEMPLATE_LOGICALID_MARKER,
        assemblyRelativeTemplateFile: 'SNInner.nested.template.json',
      });
    });

    test('the marker round-trips through byTemplateLocation', async () => {
      // This is the lookup a navigator performs: template file in, producing
      // construct out.
      dir = nestedStackAssembly();
      const index = await indexOf(dir);

      expect(index.byTemplateLocation('S.template.json', ENTIRE_TEMPLATE_LOGICALID_MARKER)!.constructPath).toBe('S');
      expect(index.byTemplateLocation('SNInner.nested.template.json', ENTIRE_TEMPLATE_LOGICALID_MARKER)!.constructPath).toBe('S/N');
    });

    test('does not overwrite the nested stack resource, which has a real logical id', async () => {
      // `S/N` is the producer; the `AWS::CloudFormation::Stack` resource next to it
      // is an ordinary resource in the PARENT template and must stay that way.
      dir = nestedStackAssembly();

      expect((await indexOf(dir)).byPath('S/N.NestedStack/N.NestedStackResource')!.cfnResource).toMatchObject({
        logicalId: 'NNestedStackRes',
        assemblyRelativeTemplateFile: 'S.template.json',
      });
    });
  });
});

describe('nested assemblies (Stages)', () => {
  /**
   * A Stage sub-assembly, whose stack in turn contains a NestedStack. Every
   * template path the index reports must be relative to the ROOT assembly
   * directory, so it stays usable as a key by callers that only know the root.
   */
  function stageAssembly(): string {
    return writeFiles({
      'manifest.json': {
        version: '0.0.0',
        artifacts: {
          'Root': {
            type: 'aws:cloudformation:stack',
            environment: 'aws://111/us-east-1',
            properties: { templateFile: 'Root.template.json' },
            displayName: 'Root',
            metadata: { '/Root/Bucket/Resource': [{ type: 'aws:cdk:logicalId', data: 'RootBucket' }] },
          },
          'assembly-Prod': { type: 'cdk:cloud-assembly', properties: { directoryName: 'assembly-Prod', displayName: 'Prod' } },
        },
      },
      'Root.template.json': { Resources: { RootBucket: { Type: 'AWS::S3::Bucket' } } },

      'assembly-Prod/manifest.json': {
        version: '0.0.0',
        artifacts: {
          'Prod-Service': {
            type: 'aws:cloudformation:stack',
            environment: 'aws://111/us-east-1',
            properties: { templateFile: 'Prod-Service.template.json' },
            // hierarchicalId: what the construct paths in metadata are keyed on.
            displayName: 'Prod/Service',
            metadata: {
              '/Prod/Service/Bucket/Resource': [{ type: 'aws:cdk:logicalId', data: 'SvcBucket' }],
              '/Prod/Service/Inner/Queue/Resource': [
                { type: 'aws:cdk:logicalId', data: 'InnerQueue' },
                { type: 'aws:cdk:propertyAssignment', data: { propertyName: 'VisibilityTimeout', stackTrace: ['stageMutation'] } },
              ],
            },
          },
        },
      },
      'assembly-Prod/Prod-Service.template.json': {
        Resources: {
          SvcBucket: { Type: 'AWS::S3::Bucket' },
          InnerRes: {
            Type: 'AWS::CloudFormation::Stack',
            Metadata: {
              'aws:cdk:path': 'Prod/Service/Inner.NestedStack/Inner.NestedStackResource',
              // Asset paths are relative to the template that references them.
              'aws:asset:path': 'ProdServiceInner.nested.template.json',
            },
          },
        },
      },
      'assembly-Prod/ProdServiceInner.nested.template.json': { Resources: { InnerQueue: { Type: 'AWS::SQS::Queue' } } },
    });
  }

  test('reports a Stage stack template relative to the root assembly', async () => {
    dir = stageAssembly();
    const index = await indexOf(dir);

    expect(index.byPath('Root/Bucket/Resource')!.cfnResource.assemblyRelativeTemplateFile).toBe('Root.template.json');
    expect(index.byPath('Prod/Service/Bucket/Resource')!.cfnResource.assemblyRelativeTemplateFile)
      .toBe('assembly-Prod/Prod-Service.template.json');
  });

  test('keeps a nested stack inside a Stage root-relative, not sub-assembly-relative', async () => {
    dir = stageAssembly();

    expect((await indexOf(dir)).byPath('Prod/Service/Inner/Queue/Resource')!.cfnResource.assemblyRelativeTemplateFile)
      .toBe('assembly-Prod/ProdServiceInner.nested.template.json');
  });

  test('exposes mutation sites inside a nested assembly', async () => {
    dir = stageAssembly();
    const index = await indexOf(dir);
    expect(index.byTemplateLocation('assembly-Prod/ProdServiceInner.nested.template.json', 'InnerQueue')!.propertyMutationStacks)
      .toEqual({ VisibilityTimeout: [['stageMutation']] });
    expect(index.byPath('Root/Bucket/Resource')!.propertyMutationStacks).toBeUndefined();
  });

  test('byTemplateLocation round-trips the root-relative path it reports', async () => {
    dir = stageAssembly();
    const index = await indexOf(dir);

    expect(index.byTemplateLocation('assembly-Prod/Prod-Service.template.json', 'SvcBucket')!.constructPath)
      .toBe('Prod/Service/Bucket/Resource');
    expect(index.byTemplateLocation('assembly-Prod/ProdServiceInner.nested.template.json', 'InnerQueue')!.constructPath)
      .toBe('Prod/Service/Inner/Queue/Resource');
    // The sub-assembly-relative name must NOT resolve; it is ambiguous across stages.
    expect(index.byTemplateLocation('Prod-Service.template.json', 'SvcBucket')).toBeUndefined();
  });

  test('does not cross-contaminate two stages that share stack and logical ids', async () => {
    const stage = (name: string) => ({
      [`assembly-${name}/manifest.json`]: {
        version: '0.0.0',
        artifacts: {
          [`${name}-Service`]: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://111/us-east-1',
            properties: { templateFile: `${name}-Service.template.json` },
            displayName: `${name}/Service`,
            metadata: { [`/${name}/Service/Data/Resource`]: [{ type: 'aws:cdk:logicalId', data: 'DataX' }] },
          },
        },
      },
      [`assembly-${name}/${name}-Service.template.json`]: { Resources: { DataX: { Type: 'AWS::S3::Bucket' } } },
    });

    dir = writeFiles({
      'manifest.json': {
        version: '0.0.0',
        artifacts: {
          'assembly-Prod': { type: 'cdk:cloud-assembly', properties: { directoryName: 'assembly-Prod', displayName: 'Prod' } },
          'assembly-Dev': { type: 'cdk:cloud-assembly', properties: { directoryName: 'assembly-Dev', displayName: 'Dev' } },
        },
      },
      ...stage('Prod'),
      ...stage('Dev'),
    });
    const index = await indexOf(dir);

    expect(index.byPath('Prod/Service/Data/Resource')!.cfnResource.assemblyRelativeTemplateFile)
      .toBe('assembly-Prod/Prod-Service.template.json');
    expect(index.byPath('Dev/Service/Data/Resource')!.cfnResource.assemblyRelativeTemplateFile)
      .toBe('assembly-Dev/Dev-Service.template.json');
    expect(index.byTemplateLocation('assembly-Prod/Prod-Service.template.json', 'DataX')!.constructPath)
      .toBe('Prod/Service/Data/Resource');
    expect(index.byTemplateLocation('assembly-Dev/Dev-Service.template.json', 'DataX')!.constructPath)
      .toBe('Dev/Service/Data/Resource');
  });
});

describe('byTemplateLocation', () => {
  test('cannot be confused with a real logical id', () => {
    // The marker is only safe to mix into the logicalId field because CloudFormation
    // would never accept it as one (logical IDs are alphanumeric).
    expect(ENTIRE_TEMPLATE_LOGICALID_MARKER).not.toMatch(/^[A-Za-z0-9]+$/);
  });

  test('finds a resource by template file and logical id', async () => {
    dir = singleStackAssembly();
    expect((await indexOf(dir)).byTemplateLocation('S.template.json', 'BucketABC')!.constructPath)
      .toBe('S/Bucket/Resource');
  });

  test('returns undefined for an unknown template file rather than throwing', async () => {
    dir = singleStackAssembly();
    expect((await indexOf(dir)).byTemplateLocation('does-not-exist.template.json', 'BucketABC')).toBeUndefined();
  });

  test('returns undefined for a logical id absent from that template', async () => {
    dir = singleStackAssembly();
    expect((await indexOf(dir)).byTemplateLocation('S.template.json', 'NoSuchResource')).toBeUndefined();
  });

  test('does not match a logical id that lives in a different template', async () => {
    dir = nestedTwoTemplateAssembly();
    const index = await indexOf(dir);

    expect(index.byTemplateLocation('SNInner.nested.template.json', 'NestedQueue')!.constructPath).toBe('S/N/Queue/Resource');
    // NestedQueue is real, but not in the parent template.
    expect(index.byTemplateLocation('S.template.json', 'NestedQueue')).toBeUndefined();
  });

  /** Parent + nested template, each with one distinctly-named resource. */
  function nestedTwoTemplateAssembly(): string {
    return writeFiles({
      'manifest.json': {
        version: '0.0.0',
        artifacts: {
          S: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://111/us-east-1',
            properties: { templateFile: 'S.template.json' },
            metadata: {
              '/S/TopBucket/Resource': [{ type: 'aws:cdk:logicalId', data: 'TopBucket' }],
              '/S/N/Queue/Resource': [{ type: 'aws:cdk:logicalId', data: 'NestedQueue' }],
              '/S/N.NestedStack/N.NestedStackResource': [{ type: 'aws:cdk:logicalId', data: 'NNestedStackRes' }],
            },
          },
        },
      },
      'S.template.json': {
        Resources: {
          TopBucket: { Type: 'AWS::S3::Bucket' },
          NNestedStackRes: {
            Type: 'AWS::CloudFormation::Stack',
            Metadata: { 'aws:cdk:path': 'S/N.NestedStack/N.NestedStackResource', 'aws:asset:path': 'SNInner.nested.template.json' },
          },
        },
      },
      'SNInner.nested.template.json': { Resources: { NestedQueue: { Type: 'AWS::SQS::Queue' } } },
    });
  }
});

describe('traceViolation', () => {
  /** Stack with one resource that has a creation stack, for join assertions. */
  function violationAssembly(): string {
    return writeFiles({
      'manifest.json': {
        version: '0.0.0',
        artifacts: {
          S: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://111/us-east-1',
            properties: { templateFile: 'S.template.json' },
            metadata: {
              '/S/Bucket/Resource': [
                { type: 'aws:cdk:creationStack', data: ['nodeFrame1', 'nodeFrame2'] },
                { type: 'aws:cdk:logicalId', data: 'BucketABC' },
              ],
            },
          },
        },
      },
      'S.template.json': { Resources: { BucketABC: { Type: 'AWS::S3::Bucket' } } },
    });
  }

  test('resolves the construct and prefers indexed resource data over the report', async () => {
    dir = violationAssembly();
    const traced = (await indexOf(dir)).traceViolation({
      constructPath: 'S/Bucket/Resource',
      cloudFormationResource: { templatePath: 'STALE.json', logicalId: 'STALE', propertyPaths: ['Properties.Public'] },
    });

    expect(traced.node!.constructPath).toBe('S/Bucket/Resource');
    expect(traced.cfnResource).toEqual({
      templatePath: 'S.template.json',
      logicalId: 'BucketABC',
      propertyPaths: ['Properties.Public'],
    });
  });

  test('falls back to the node creation stack when the report carries no traces', async () => {
    dir = violationAssembly();
    const traced = (await indexOf(dir)).traceViolation({ constructPath: 'S/Bucket/Resource' });

    expect(traced.stackTraces).toEqual([['nodeFrame1', 'nodeFrame2']]);
  });

  test('splits the report own newline-separated traces and prefers them', async () => {
    dir = violationAssembly();
    const traced = (await indexOf(dir)).traceViolation({
      constructPath: 'S/Bucket/Resource',
      stackTraces: ['frameA\nframeB', 'frameC'],
    });

    expect(traced.stackTraces).toEqual([['frameA', 'frameB'], ['frameC']]);
  });

  test('falls back to the report resource fields for a construct absent from the index', async () => {
    dir = violationAssembly();
    const traced = (await indexOf(dir)).traceViolation({
      constructPath: 'Ghost/Thing',
      cloudFormationResource: { templatePath: 'Other.template.json', logicalId: 'X9', propertyPaths: ['P'] },
    });

    expect(traced.node).toBeUndefined();
    expect(traced.cfnResource).toEqual({ templatePath: 'Other.template.json', logicalId: 'X9', propertyPaths: ['P'] });
    expect(traced.stackTraces).toEqual([]);
  });

  test('leaves the resource undefined when neither index nor report has one', async () => {
    dir = violationAssembly();
    const traced = (await indexOf(dir)).traceViolation({ constructPath: 'Ghost/Thing' });

    expect(traced.node).toBeUndefined();
    expect(traced.cfnResource).toBeUndefined();
    expect(traced.violation.constructPath).toBe('Ghost/Thing');
  });

  test('a trace that came from an annotation arrives parsed and JustMyCode-rendered', async () => {
    // End to end over both halves of the path a construct annotation takes: the
    // report synthesized from stack metadata renders the raw `constructs` trace
    // as JustMyCode, and the index hands the result to its caller as frames.
    dir = writeFiles({
      'manifest.json': {
        version: '0.0.0',
        artifacts: {
          S: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://111/us-east-1',
            properties: { templateFile: 'S.template.json' },
            metadata: {
              '/S/Bucket/Resource': [
                { type: 'aws:cdk:logicalId', data: 'BucketABC' },
                {
                  type: 'aws:cdk:warning',
                  data: 'be careful',
                  trace: [
                    'new Bucket (/home/dev/app/node_modules/aws-cdk-lib/aws-s3/lib/bucket.js:1:2)',
                    'new Bucket2 (/home/dev/app/node_modules/aws-cdk-lib/core/lib/prop-injectable.js:1:726)',
                    'new MyStack (/home/dev/app/lib/my-stack.ts:12:5)',
                  ],
                },
              ],
            },
          },
        },
      },
      'S.template.json': { Resources: { BucketABC: { Type: 'AWS::S3::Bucket' } } },
    });
    const assembly = new CloudAssembly(dir);
    const [report] = await loadUnifiedValidationReport(assembly, assembly.stacksRecursively);
    const violatingConstruct = report.violations[0].violatingConstructs[0];

    // WHEN
    const traced = (await AssemblyIndex.fromAssembly(assembly)).traceViolation(violatingConstruct);

    // THEN - the aws-cdk-lib frames are collapsed into one summary line and the
    // user's own frame survives, so the trace points at code the user can fix.
    expect(traced.stackTraces).toEqual([[
      '    ...new Bucket2 in aws-cdk-lib...',
      '    at new MyStack (/home/dev/app/lib/my-stack.ts:12:5)',
    ]]);
  });
});
