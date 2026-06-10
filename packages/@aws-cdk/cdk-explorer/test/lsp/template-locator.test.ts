import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { readAssembly, type ConstructNode } from '../../lib';
import { resourceTarget } from '../../lib/lsp/template-locator';
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

  test('resolves to the definition key, not Ref/DependsOn occurrences of the same id', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locator-'));
    const file = path.join(dir, 'T.template.json');
    fs.writeFileSync(file, TEMPLATE);
    // MyBucketF68F3FF0 is defined on line 2 and also referenced (Ref line 8,
    // DependsOn line 10); only the definition is a `"<id>":` key, so line 2 wins.
    expect(resourceTarget({ templateFile: file, logicalId: 'MyBucketF68F3FF0' })?.range.start)
      .toEqual({ line: 2, character: 4 });
  });

  test('does not match a logical id that is a prefix of a longer key', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locator-'));
    const file = path.join(dir, 'T.template.json');
    fs.writeFileSync(file, [
      '{',
      '  "Resources": {',
      '    "MyBucketF68F3FF0": {',
      '      "Type": "AWS::S3::Bucket"',
      '    },',
      '    "MyBucket": {',
      '      "Type": "AWS::S3::Bucket"',
      '    }',
      '  }',
      '}',
    ].join('\n'));
    // The closing quote in the match key stops "MyBucket" matching "MyBucketF68F3FF0":
    expect(resourceTarget({ templateFile: file, logicalId: 'MyBucket' })?.range.start)
      .toEqual({ line: 5, character: 4 });
  });
});
