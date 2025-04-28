import * as fs from 'node:fs';
import {
  ManifestSkipList,
  SkipFile,
  UnionSkipList,
} from '../../../../@aws-cdk/tmp-toolkit-helpers/src/api/refactoring/skip';
import { ArtifactMetadataEntryType, ArtifactType } from '@aws-cdk/cloud-assembly-schema';

describe('ManifestSkipList', () => {
  test('returns resource locations marked with SKIP_REFACTOR in the manifest', () => {
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
            bootstrapStackVersionSsmParameter: '/cdk-bootstrap/hnb659fds/version',
          },
        },
      },
    };

    const skipList = new ManifestSkipList(manifest as any);
    expect(skipList.resourceLocations).toEqual([
      {
        StackName: 'Stack1',
        LogicalResourceId: 'Resource1',
      },
      {
        StackName: 'Stack2',
        LogicalResourceId: 'Resource2',
      },
    ]);
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
    expect(skipList.resourceLocations).toEqual([]);
  });
});

describe('SkipFile', () => {
  test('returns resource locations from a valid JSON file', () => {
    const filePath = '/path/to/skip-list.json';
    const fileContent = JSON.stringify(['Stack1.Resource1', 'Stack2.Resource2']);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    const skipList = new SkipFile(filePath);
    expect(skipList.resourceLocations).toEqual([
      {
        StackName: 'Stack1',
        LogicalResourceId: 'Resource1',
      },
      {
        StackName: 'Stack2',
        LogicalResourceId: 'Resource2',
      },
    ]);
  });

  test('returns an empty array if no file path is provided', () => {
    const skipList = new SkipFile();
    expect(skipList.resourceLocations).toEqual([]);
  });

  test('throws an error if the content is not an array', () => {
    const filePath = '/path/to/skip-list.json';
    const fileContent = JSON.stringify({ spuriousKey: ['Stack1.Resource1', 'Stack2.Resource2'] });
    jest.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    const skipList = new SkipFile(filePath);
    expect(() => skipList.resourceLocations).toThrow('The content of a skip file must be a JSON array of strings');
  });

  test('throws an error if the content is an array but not of strings', () => {
    const filePath = '/path/to/skip-list.json';
    const fileContent = JSON.stringify([1, 2, 3]);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    const skipList = new SkipFile(filePath);
    expect(() => skipList.resourceLocations).toThrow('The content of a skip file must be a JSON array of strings');
  });

  test('throws an error if the some entries are not valid resource locations', () => {
    const filePath = '/path/to/skip-list.json';
    const fileContent = JSON.stringify(['Stack1.Resource1', 'InvalidResourceLocation']);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    const skipList = new SkipFile(filePath);
    expect(() => skipList.resourceLocations).toThrow(
      'Invalid resource location format: InvalidResourceLocation. Expected format: stackName.logicalId',
    );
  });
});

describe('UnionSkipList', () => {
  test('combines resource IDs from multiple skip lists', () => {
    const skipList1 = {
      resourceIds: ['Resource1', 'Resource2'],
      resourceLocations: [
        {
          StackName: 'Stack1',
          LogicalResourceId: 'Resource1',
        },
        {
          StackName: 'Stack2',
          LogicalResourceId: 'Resource2',
        },
      ],
    };
    const skipList2 = {
      resourceIds: ['Resource3'],
      resourceLocations: [
        {
          StackName: 'Stack3',
          LogicalResourceId: 'Resource3',
        },
      ],
    };

    const unionSkipList = new UnionSkipList([skipList1, skipList2]);
    expect(unionSkipList.resourceLocations).toEqual([
      {
        StackName: 'Stack1',
        LogicalResourceId: 'Resource1',
      },
      {
        StackName: 'Stack2',
        LogicalResourceId: 'Resource2',
      },
      {
        StackName: 'Stack3',
        LogicalResourceId: 'Resource3',
      },
    ]);
  });

  test('returns an empty array if no skip lists are provided', () => {
    const unionSkipList = new UnionSkipList([]);
    expect(unionSkipList.resourceLocations).toEqual([]);
  });
});
