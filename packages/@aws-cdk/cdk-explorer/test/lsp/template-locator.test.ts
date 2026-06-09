import { findLogicalIdPosition } from '../../lib/lsp/template-locator';

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
