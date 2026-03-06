import { Deployments } from '../../lib/api/deployments';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { instanceMockFrom, MockCloudExecutable } from '../_helpers';

describe('publish', () => {
  let cloudExecutable: MockCloudExecutable;
  let cloudFormation: jest.Mocked<Deployments>;
  let toolkit: CdkToolkit;
  let ioHost = CliIoHost.instance();

  beforeEach(async () => {
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'Stack1',
          template: {
            Resources: {
              Bucket: { Type: 'AWS::S3::Bucket' },
            },
          },
        },
      ],
    }, undefined, ioHost);

    cloudFormation = instanceMockFrom(Deployments);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });

    // Mock the toolkit.publish method from toolkit-lib
    jest.spyOn((toolkit as any).toolkit, 'publish').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('publishes with correct stack selector and force option', async () => {
    // WHEN
    await toolkit.publish({
      selector: { patterns: ['Stack1'] },
      force: true,
    });

    // THEN
    expect((toolkit as any).toolkit.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stacks: expect.objectContaining({
          patterns: ['Stack1'],
        }),
        force: true,
      }),
    );
  });

  test('publishes successfully', async () => {
    // WHEN
    await toolkit.publish({
      selector: { patterns: ['Stack1'] },
    });

    // THEN
    expect((toolkit as any).toolkit.publish).toHaveBeenCalled();
  });

  test('passes all options correctly', async () => {
    // WHEN
    await toolkit.publish({
      selector: { patterns: ['Stack1'] },
      force: true,
      concurrency: 5,
      roleArn: 'arn:aws:iam::123456789012:role/TestRole',
    });

    // THEN
    expect((toolkit as any).toolkit.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        force: true,
        concurrency: 5,
        roleArn: 'arn:aws:iam::123456789012:role/TestRole',
      }),
    );
  });
});
