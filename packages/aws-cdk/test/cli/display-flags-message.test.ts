import { Toolkit } from '@aws-cdk/toolkit-lib';
import { displayFlagsMessage } from '../../lib/cli/cdk-toolkit';
import { TestIoHost } from '../_helpers/io-host';

describe('displayFlagsMessage', () => {
  let mockToolkit: jest.Mocked<Toolkit>;
  let mockCloudExecutable: any;
  let ioHost: TestIoHost;

  beforeEach(() => {
    mockCloudExecutable = {};
    ioHost = new TestIoHost();

    mockToolkit = {
      flags: jest.fn(),
    } as any;

    jest.spyOn(Toolkit.prototype, 'flags').mockImplementation(mockToolkit.flags);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('displays message with correct count of unconfigured flags, filtering out obsolete flags', async () => {
    const mockFlagsData = [
      {
        name: '@aws-cdk/core:testFlag',
        userValue: undefined,
        recommendedValue: 'true',
        explanation: 'Test flag',
        module: 'aws-cdk-lib',
      },
      {
        name: '@aws-cdk/s3:anotherFlag',
        userValue: 'false',
        recommendedValue: 'false',
        explanation: 'Another test flag',
        module: 'aws-cdk-lib',
      },
      {
        name: '@aws-cdk/core:enableStackNameDuplicates',
        userValue: undefined,
        recommendedValue: 'true',
        explanation: 'Obsolete flag',
        module: 'aws-cdk-lib',
      },
    ];

    mockToolkit.flags.mockResolvedValue(mockFlagsData);

    await displayFlagsMessage(ioHost.asHelper(), mockToolkit as any, mockCloudExecutable);

    expect(mockToolkit.flags).toHaveBeenCalledWith(mockCloudExecutable);
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('1 feature flags are not configured'),
    }));
  });
  test('does not display a message when user has no unconfigured flags', async () => {
    const mockFlagsData = [
      {
        name: '@aws-cdk/s3:anotherFlag',
        userValue: 'false',
        recommendedValue: 'false',
        explanation: 'Another test flag',
        module: 'aws-cdk-lib',
      },
    ];
    mockToolkit.flags.mockResolvedValue(mockFlagsData);

    await displayFlagsMessage(ioHost.asHelper(), mockToolkit as any, mockCloudExecutable);

    expect(mockToolkit.flags).toHaveBeenCalledWith(mockCloudExecutable);
    expect(ioHost.notifySpy).not.toHaveBeenCalled();
  });
});

