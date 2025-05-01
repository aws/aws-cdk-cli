import { ArtifactMetadataEntryType, ArtifactType } from '@aws-cdk/cloud-assembly-schema';
import {
  AlwaysExclude,
  InMemoryExcludeList,
  ManifestExcludeList,
  NeverExclude,
  UnionExcludeList,
} from '../../../lib/api/refactoring';
import type { CloudFormationStack } from '../../../lib/api/refactoring/cloudformation';
import { ResourceLocation } from '../../../lib/api/refactoring/cloudformation';

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

    const skipList = new ManifestExcludeList(manifest as any);

    expect(skipList.isExcluded(resource1)).toBe(true);
    expect(skipList.isExcluded(resource2)).toBe(true);
    expect(skipList.isExcluded(resource3)).toBe(false);
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

    const skipList = new ManifestExcludeList(manifest as any);
    expect(skipList.isExcluded(resource1)).toBe(false);
  });
});

describe('InMemorySkipList', () => {
  test('valid resources on a valid list are skipped', () => {
    const skipList = new InMemoryExcludeList(['Stack1.Resource1', 'Stack2/Resource3']);
    expect(skipList.isExcluded(resource1)).toBe(true);
    expect(skipList.isExcluded(resource2)).toBe(false);
    expect(skipList.isExcluded(resource3)).toBe(true);
  });

  test('nothing is skipped if no file path is provided', () => {
    const skipList = new InMemoryExcludeList([]);
    expect(skipList.isExcluded(resource1)).toBe(false);
    expect(skipList.isExcluded(resource2)).toBe(false);
    expect(skipList.isExcluded(resource3)).toBe(false);
  });
});

describe('UnionSkipList', () => {
  test('skips a resource if at least one underlying list skips', () => {
    const skipList1 = new AlwaysExclude();
    const skipList2 = new NeverExclude();

    const unionSkipList = new UnionExcludeList([skipList1, skipList2]);
    expect(unionSkipList.isExcluded(resource1)).toBe(true);
  });

  test('does not skip a resource if all underlying lists do not skip', () => {
    const skipList1 = new NeverExclude();
    const skipList2 = new NeverExclude();

    const unionSkipList = new UnionExcludeList([skipList1, skipList2]);
    expect(unionSkipList.isExcluded(resource1)).toBe(false);
  });
});
