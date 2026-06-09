import * as path from 'path';
import { pathToFileURL } from 'url';
import { readAssembly, type ConstructNode } from '../../lib';
import { findLogicalIdPosition, resourceTarget } from '../../lib/lsp/template-locator';
import { buildFlatAssembly, cleanupFixture } from '../_fixtures/builders';

// A synthesized-style template where MyBucketF68F3FF0 is defined once and also
// referenced (Ref + DependsOn) -- the references must not be matched.
const TEMPLATE = [
  '{',
  '  "Resources": {',
  '    "MyBucketF68F3FF0": {',
  '      "Type": "AWS::S3::Bucket"',
  '    },',
  '    "MyPolicy3A1B2C3D": {',
  '      "Type": "AWS::IAM::Policy",',
  '      "Properties": {',
  '        "Bucket": { "Ref": "MyBucketF68F3FF0" }',
  '      },',
  '      "DependsOn": [ "MyBucketF68F3FF0" ]',
  '    }',
  '  }',
  '}',
].join('\n');

describe('findLogicalIdPosition', () => {
  test('returns the 0-based position of the resource key', () => {
    // Key sits on line index 5, opening quote at character 4 (4-space indent).
    expect(findLogicalIdPosition(TEMPLATE, 'MyPolicy3A1B2C3D')).toEqual({ line: 5, character: 4 });
  });

  test('matches the definition key, not Ref/DependsOn occurrences of the same id', () => {
    // MyBucketF68F3FF0 appears on lines 2 (definition), 8 (Ref) and 10 (DependsOn);
    // only the definition is a `"<id>":` key, so line 2 must win.
    expect(findLogicalIdPosition(TEMPLATE, 'MyBucketF68F3FF0')).toEqual({ line: 2, character: 4 });
  });

  test('returns undefined when the logical id is absent', () => {
    expect(findLogicalIdPosition(TEMPLATE, 'NotARealId')).toBeUndefined();
  });
});

describe('resourceTarget', () => {
  let dir: string | undefined;

  afterEach(() => {
    cleanupFixture(dir);
    dir = undefined;
  });

  const find = (nodes: readonly ConstructNode[], targetPath: string): ConstructNode | undefined => {
    for (const node of nodes) {
      if (node.path === targetPath) return node;
      const hit = find(node.children, targetPath);
      if (hit) return hit;
    }
    return undefined;
  };

  test('resolves a resource node to its template uri and key position', () => {
    dir = buildFlatAssembly({
      stacks: [{ id: 'Stack1', resources: [{ id: 'MyBucket', logicalId: 'MyBucketF68F3FF0', cfnType: 'AWS::S3::Bucket' }] }],
    });
    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');
    const node = find(result.data.tree, 'Stack1/MyBucket/Resource')!;

    const target = resourceTarget(node);
    expect(target?.uri).toBe(pathToFileURL(path.join(dir!, 'Stack1.template.json')).toString());
    // 2-space indented template: the key sits on line 2, opening quote at char 4.
    expect(target?.range).toEqual({ start: { line: 2, character: 4 }, end: { line: 2, character: 4 } });
  });

  test('returns undefined for a node without a logical id (wrapper) -- no file read', () => {
    expect(resourceTarget({ templateFile: '/does/not/matter.json', logicalId: undefined })).toBeUndefined();
  });

  test('returns undefined for a node without a resolved templateFile', () => {
    expect(resourceTarget({ templateFile: undefined, logicalId: 'MyBucketF68F3FF0' })).toBeUndefined();
  });

  test('returns undefined when the logical id is not in the resolved template', () => {
    dir = buildFlatAssembly({
      stacks: [{ id: 'Stack1', resources: [{ id: 'MyBucket', logicalId: 'MyBucketF68F3FF0', cfnType: 'AWS::S3::Bucket' }] }],
    });
    expect(resourceTarget({ templateFile: path.join(dir, 'Stack1.template.json'), logicalId: 'GhostId' })).toBeUndefined();
  });

  test('returns undefined (does not throw) when the template can no longer be read', () => {
    expect(resourceTarget({ templateFile: '/no/such/template.json', logicalId: 'MyBucketF68F3FF0' })).toBeUndefined();
  });
});
