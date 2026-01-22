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

describe('ManifestExcludeList', () => {
  test('locations marked with DO_NOT_REFACTOR in the manifest are excluded', () => {
    const manifest = {
      artifacts: {
        'Stack1': {
          type: ArtifactType.AWS_CLOUDFORMATION_STACK,
          metadata: {
            LogicalId1: [
              { type: ArtifactMetadataEntryType.DO_NOT_REFACTOR, data: true },
              { type: ArtifactMetadataEntryType.LOGICAL_ID, data: 'Resource1' },
            ],
          },
        },
        'Stack2': {
          type: ArtifactType.AWS_CLOUDFORMATION_STACK,
          metadata: {
            LogicalId2: [
              { type: ArtifactMetadataEntryType.DO_NOT_REFACTOR, data: true },
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

    const excludeList = new ManifestExcludeList('/', manifest as any);

    expect(excludeList.isExcluded(resource1)).toBe(true);
    expect(excludeList.isExcluded(resource2)).toBe(true);
    expect(excludeList.isExcluded(resource3)).toBe(false);
  });

  test('nothing is excluded if no DO_NOT_REFACTOR entries exist', () => {
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

    const excludeList = new ManifestExcludeList('/', manifest as any);
    expect(excludeList.isExcluded(resource1)).toBe(false);
  });
});

describe('InMemoryexcludeList', () => {
  test('valid resources on a valid list are excluded', () => {
    const excludeList = new InMemoryExcludeList(['Stack1.Resource1', 'Stack2/Resource3']);
    expect(excludeList.isExcluded(resource1)).toBe(true);
    expect(excludeList.isExcluded(resource2)).toBe(false);
    expect(excludeList.isExcluded(resource3)).toBe(true);
  });

  test('nothing is excluded if no file path is provided', () => {
    const excludeList = new InMemoryExcludeList([]);
    expect(excludeList.isExcluded(resource1)).toBe(false);
    expect(excludeList.isExcluded(resource2)).toBe(false);
    expect(excludeList.isExcluded(resource3)).toBe(false);
  });
});

describe('UnionexcludeList', () => {
  test('excludes a resource if at least one underlying list excludes', () => {
    const excludeList1 = new AlwaysExclude();
    const excludeList2 = new NeverExclude();

    const unionexcludeList = new UnionExcludeList([excludeList1, excludeList2]);
    expect(unionexcludeList.isExcluded(resource1)).toBe(true);
  });

  test('does not exclude a resource if all underlying lists do not exclude', () => {
    const excludeList1 = new NeverExclude();
    const excludeList2 = new NeverExclude();

    const unionExcludeList = new UnionExcludeList([excludeList1, excludeList2]);
    expect(unionExcludeList.isExcluded(resource1)).toBe(false);
  });
});
