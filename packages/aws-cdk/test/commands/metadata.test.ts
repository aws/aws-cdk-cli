import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import { Deployments } from '../../lib/api/deployments';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { instanceMockFrom, MockCloudExecutable } from '../_helpers';
import type { TestStackArtifact } from '../_helpers';
import { IoHostRecorder } from '../_helpers/io-recorder';

const STACK: TestStackArtifact = {
  stackName: 'Test-Stack',
  template: { Resources: { MyBucket: { Type: 'AWS::S3::Bucket' } } },
  env: 'aws://123456789012/bermuda-triangle-1',
  metadata: {
    '/Test-Stack': [
      {
        type: cxschema.ArtifactMetadataEntryType.STACK_TAGS,
        data: [{ key: 'environment', value: 'test' }],
      },
    ],
    '/Test-Stack/MyBucket': [
      {
        type: cxschema.ArtifactMetadataEntryType.LOGICAL_ID,
        data: 'MyBucketF68F3FF0',
      },
      {
        type: cxschema.ArtifactMetadataEntryType.INFO,
        data: 'Metadata about the test bucket',
      },
    ],
  },
};

describe('cdk metadata', () => {
  const ioHost = CliIoHost.instance();
  let recorder: IoHostRecorder;
  let toolkit: CdkToolkit;

  beforeEach(async () => {
    jest.resetAllMocks();
    ioHost.currentAction = 'metadata';

    const cloudExecutable = await MockCloudExecutable.create({ stacks: [STACK] }, undefined, ioHost, 'metadata');
    toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: instanceMockFrom(Deployments),
    });

    recorder = IoHostRecorder.create(ioHost);
  });

  afterEach(() => {
    recorder.matchSnapshot();
  });

  test('prints metadata as YAML by default', async () => {
    await toolkit.metadata('Test-Stack', false);
  });

  test('prints metadata as JSON with --json', async () => {
    await toolkit.metadata('Test-Stack', true);
  });
});
