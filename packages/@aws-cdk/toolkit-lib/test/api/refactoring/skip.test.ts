import * as fs from 'node:fs';
import { ArtifactMetadataEntryType, ArtifactType } from '@aws-cdk/cloud-assembly-schema';
import {
  ManifestSkipList,
  NeverSkipList,
  SkipFile,
  AlwaysSkipList,
  UnionSkipList,
} from '../../../lib/api/refactoring';
import type { CloudFormationStack } from '../../../lib/api/refactoring/cloudformation';
import {
  ResourceLocation,
} from '../../../lib/api/refactoring/cloudformation';

const environment = {
  name: 'prod',
  account: '123456789012',
  region: 'us-east-1',
};

const stack1: CloudFormationStack = {
  stackName: 'Stack1',
  environment,
  template: {},
};
const stack2: CloudFormationStack = {
  stackName: 'Stack2',
  environment,
  template: {
    Resources: {
      Resource3: {
        Type: 'AWS::S3::Bucket',
        Metadata: {
          'aws:cdk:path': 'Stack2/Resource3',
        },
      },
    },
  },
};

const resource1 = new ResourceLocation(stack1, 'Resource1');
const resource2 = new ResourceLocation(stack2, 'Resource2');
const resource3 = new ResourceLocation(stack2, 'Resource3');

describe('ManifestSkipList', () => {
  test('locations marked with SKIP_REFACTOR in the manifest are skipped', () => {
    const manifest = {
      artifacts: {
        'Stack1': {
          type: ArtifactType.AWS_CLOUDFORMATION_STACK,
          metadata: {
            LogicalId1: [
              { type: ArtifactMetadataEntryType.SKIP_REFACTOR, data: true },
              { type: ArtifactMetadataEntryType.LOGICAL_ID, data: 'Resource1' },
            ],
          },
        },
        'Stack2': {
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

    expect(skipList.isSkipped(resource1)).toBe(true);
    expect(skipList.isSkipped(resource2)).toBe(true);
    expect(skipList.isSkipped(resource3)).toBe(false);
  });

  test('nothing is skipped if no SKIP_REFACTOR entries exist', () => {
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
    expect(skipList.isSkipped(resource1)).toBe(false);
  });
});

describe('SkipFile', () => {
  test('valid resources on a valid list are skipped', () => {
    const filePath = '/path/to/skip-list.json';
    const fileContent = JSON.stringify(['Stack1.Resource1', 'Stack2/Resource3']);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    const skipList = new SkipFile(filePath);
    expect(skipList.isSkipped(resource1)).toBe(true);
    expect(skipList.isSkipped(resource2)).toBe(false);
    expect(skipList.isSkipped(resource3)).toBe(true);
  });

  test('nothing is skipped if no file path is provided', () => {
    const skipList = new SkipFile();
    expect(skipList.isSkipped(resource1)).toBe(false);
    expect(skipList.isSkipped(resource2)).toBe(false);
    expect(skipList.isSkipped(resource3)).toBe(false);
  });

  test('throws an error if the content is not an array', () => {
    const filePath = '/path/to/skip-list.json';
    const fileContent = JSON.stringify({ spuriousKey: ['Stack1.Resource1', 'Stack2.Resource2'] });
    jest.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    expect(() => new SkipFile(filePath)).toThrow('The content of a skip file must be a JSON array of strings');
  });

  test('throws an error if the content is an array but not of strings', () => {
    const filePath = '/path/to/skip-list.json';
    const fileContent = JSON.stringify([1, 2, 3]);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    expect(() => new SkipFile(filePath)).toThrow('The content of a skip file must be a JSON array of strings');
  });

  test('throws an error if the some entries are not valid resource locations', () => {
    const filePath = '/path/to/skip-list.json';
    const fileContent = JSON.stringify(['Stack1.Resource1', 'Invalid-Resource-Location']);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(fileContent);

    expect(() => new SkipFile(filePath)).toThrow(/Invalid resource location format: Invalid-Resource-Location/);
  });
});

describe('UnionSkipList', () => {
  test('skips a resource if at least one underlying list skips', () => {
    const skipList1 = new AlwaysSkipList();
    const skipList2 = new NeverSkipList();

    const unionSkipList = new UnionSkipList([skipList1, skipList2]);
    expect(unionSkipList.isSkipped(resource1)).toBe(true);
  });

  test('does not skip a resource if all underlying lists do not skip', () => {
    const skipList1 = new NeverSkipList();
    const skipList2 = new NeverSkipList();

    const unionSkipList = new UnionSkipList([skipList1, skipList2]);
    expect(unionSkipList.isSkipped(resource1)).toBe(false);
  });
});
