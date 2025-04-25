import * as fs from 'node:fs';
import { ManifestSkipList, FileSkipList, UnionSkipList } from '../../../../@aws-cdk/tmp-toolkit-helpers/src/api/refactoring/skip';
import { ArtifactMetadataEntryType, ArtifactType } from '@aws-cdk/cloud-assembly-schema';
import { ToolkitError } from '@aws-cdk/toolkit-lib';

describe('ManifestSkipList', () => {
  test('returns resource IDs marked with SKIP_REFACTOR in the manifest', () => {
    const manifest = {
      artifacts: {
        Stack1: {
          type: ArtifactType.AWS_CLOUDFORMATION_STACK,
          metadata: {
            LogicalId1: [
              { type: ArtifactMetadataEntryType.SKIP_REFACTOR, data: true },
              { type: ArtifactMetadataEntryType.LOGICAL_ID, data: 'Resource1' },
            ],
          },
        },
        Stack2: {
          type: ArtifactType.AWS_CLOUDFORMATION_STACK,
          metadata: {
            LogicalId2: [
              { type: ArtifactMetadataEntryType.SKIP_REFACTOR, data: true },
              { type: ArtifactMetadataEntryType.LOGICAL_ID, data: 'Resource2' },
            ],
          },
        },
        'Stack1.assets': {
          type: 'cdk:asset-manifest',
          properties: {
            file: 'Stack1.assets.json',
            requiresBootstrapStackVersion: 6,
            bootstrapStackVersionSsmParameter: '/cdk-bootstrap/hnb659fds/version'
          }
        },
      },
    };

    const skipList = new ManifestSkipList(manifest as any);
    expect(skipList.resourceIds).toEqual(['Resource1', 'Resource2']);
  });

  test('returns an empty array if no SKIP_REFACTOR entries exist', () => {
    const manifest = {
      artifacts: {
        Stack1: {
          type: ArtifactType.AWS_CLOUDFORMATION_STACK,
          metadata: {
            LogicalId1: [{ type: ArtifactMetadataEntryType.LOGICAL_ID, data: 'Resource1' }],
          },
        },
      },
    };

    const skipList = new ManifestSkipList(manifest as any);
    expect(skipList.resourceIds).toEqual([]);
  });
});

describe('FileSkipList', () => {
  test('returns resource IDs from a valid JSON file', () => {
    const filePath = '/path/to/skip-list.json';
    const fileContent = JSON.stringify(['Resource1', 'Resource2']);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    const skipList = new FileSkipList(filePath);
    expect(skipList.resourceIds).toEqual(['Resource1', 'Resource2']);
  });

  test('returns an empty array if no file path is provided', () => {
    const skipList = new FileSkipList();
    expect(skipList.resourceIds).toEqual([]);
  });

  test('throws an error if the file content is invalid', () => {
    const filePath = '/path/to/skip-list.json';
    jest.spyOn(fs, 'readFileSync').mockReturnValue('invalid-json');

    const skipList = new FileSkipList(filePath);
    expect(() => skipList.resourceIds).toThrow(SyntaxError);
  });

  test('throws an error if the content is not an array', () => {
    const filePath = '/path/to/skip-list.json';
    const fileContent = JSON.stringify({ resourceIds: ['Resource1', 'Resource2'] });
    jest.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    const skipList = new FileSkipList(filePath);
    expect(() => skipList.resourceIds).toThrow(ToolkitError);
  });
});

describe('UnionSkipList', () => {
  test('combines resource IDs from multiple skip lists', () => {
    const skipList1 = { resourceIds: ['Resource1', 'Resource2'] };
    const skipList2 = { resourceIds: ['Resource3'] };

    const unionSkipList = new UnionSkipList([skipList1, skipList2]);
    expect(unionSkipList.resourceIds).toEqual(['Resource1', 'Resource2', 'Resource3']);
  });

  test('returns an empty array if no skip lists are provided', () => {
    const unionSkipList = new UnionSkipList([]);
    expect(unionSkipList.resourceIds).toEqual([]);
  });
});