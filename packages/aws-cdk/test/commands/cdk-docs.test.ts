import { docs } from '../../lib/commands/docs';
import { runUserCommandLine } from '../../lib/private/tools';
import { TestIoHost } from '../_helpers/io-host';

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper('docs');

jest.mock('@aws-cdk/private-tools/lib/subprocess', () => ({
  runUserCommandLine: jest.fn(),
}));

const mockRunUserCommandLine = runUserCommandLine as jest.MockedFunction<typeof runUserCommandLine>;

describe('`cdk docs`', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('exits with 0 when everything is OK', async () => {
    mockRunUserCommandLine.mockResolvedValue({ stdout: '', stderr: '' });

    const result = await docs({
      ioHelper,
      browser: 'echo %u',
    });

    expect(result).toBe(0);
    expect(mockRunUserCommandLine).toHaveBeenCalledWith('echo https://docs.aws.amazon.com/cdk/api/v2/');
  });

  test('exits with 0 when opening the browser fails', async () => {
    mockRunUserCommandLine.mockRejectedValue(new Error('TEST'));

    const result = await docs({
      ioHelper,
      browser: 'echo %u',
    });

    expect(result).toBe(0);
  });
});
