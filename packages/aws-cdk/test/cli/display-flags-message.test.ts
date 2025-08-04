
import { Toolkit } from '@aws-cdk/toolkit-lib';
import { asIoHelper } from '../../lib/api-private';
import { displayFlagsMessage } from '../../lib/cli/cli';
import { TestIoHost } from '../_helpers/io-host';

describe('displayFlagsMessage', () => {
  let ioHost: TestIoHost;
  let ioHelper: any;
  let mockToolkit: jest.Mocked<Toolkit>;
  let mockCloudExecutable: any;

  beforeEach(() => {
    ioHost = new TestIoHost();
    ioHelper = asIoHelper(ioHost, 'synth');
    mockCloudExecutable = {};

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

    await displayFlagsMessage(ioHost as any, 'test-stack', mockCloudExecutable, ioHelper);

    expect(mockToolkit.flags).toHaveBeenCalledWith(mockCloudExecutable);
    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `You currently have 1 unconfigured feature flags that may require attention to keep your 
      application up-to-date. Run 'cdk flags' to learn more.`,
        level: 'info',
      }),
    );
  });
});

