import { Toolkit } from '@aws-cdk/toolkit-lib';
import { displayFlagsMessage } from '../../lib/cli/cdk-toolkit';

describe('displayFlagsMessage', () => {
  let mockToolkit: jest.Mocked<Toolkit>;
  let mockCloudExecutable: any;
  let stderrWriteSpy: jest.SpyInstance;

  beforeEach(() => {
    mockCloudExecutable = {};

    mockToolkit = {
      flags: jest.fn(),
    } as any;

    jest.spyOn(Toolkit.prototype, 'flags').mockImplementation(mockToolkit.flags);
    stderrWriteSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
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

    await displayFlagsMessage(mockToolkit as any, mockCloudExecutable);

    expect(mockToolkit.flags).toHaveBeenCalledWith(mockCloudExecutable);
    expect(stderrWriteSpy).toHaveBeenCalledWith(
      'You currently have 1 unconfigured feature flag(s) that may require attention to keep your application up-to-date. Run \'cdk flags\' to learn more.',
    );
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

    await displayFlagsMessage(mockToolkit as any, mockCloudExecutable);

    expect(mockToolkit.flags).toHaveBeenCalledWith(mockCloudExecutable);
    expect(stderrWriteSpy).not.toHaveBeenCalled();
  });
});

