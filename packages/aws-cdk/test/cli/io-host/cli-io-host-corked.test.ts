import { CliIoHost } from '../../../lib/cli/io-host';

const ioHost = CliIoHost.instance({}, true);
let mockStderr: jest.Mock;

const stripAnsi = (str: string): string => {
  const ansiRegex = /\u001b\[[0-9;]*[a-zA-Z]/g;
  return str.replace(ansiRegex, '');
};

beforeEach(() => {
  ioHost.logLevel = 'info';
  ioHost.isCI = false;

  mockStderr = jest.fn();
  jest.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
    mockStderr(stripAnsi(chunk.toString()));
    return true;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('corked logging', () => {
  test('buffers messages when corked', async () => {
    await ioHost.withCorkedLogging(async () => {
      await ioHost.asIoHelper().defaults.info('message 1');
      await ioHost.asIoHelper().defaults.info('message 2');
      expect(mockStderr).not.toHaveBeenCalled();
    });

    expect(mockStderr).toHaveBeenCalledWith('message 1\n');
    expect(mockStderr).toHaveBeenCalledWith('message 2\n');
  });

  test('handles nested corking correctly', async () => {
    await ioHost.withCorkedLogging(async () => {
      await ioHost.asIoHelper().defaults.info('outer 1');
      await ioHost.withCorkedLogging(async () => {
        await ioHost.asIoHelper().defaults.info('inner');
      });
      await ioHost.asIoHelper().defaults.info('outer 2');
      expect(mockStderr).not.toHaveBeenCalled();
    });

    expect(mockStderr).toHaveBeenCalledTimes(3);
    expect(mockStderr).toHaveBeenCalledWith('outer 1\n');
    expect(mockStderr).toHaveBeenCalledWith('inner\n');
    expect(mockStderr).toHaveBeenCalledWith('outer 2\n');
  });

  test('handles errors in corked block while preserving buffer', async () => {
    await expect(ioHost.withCorkedLogging(async () => {
      await ioHost.asIoHelper().defaults.info('message 1');
      throw new Error('test error');
    })).rejects.toThrow('test error');

    // The buffered message should still be printed even if the block throws
    expect(mockStderr).toHaveBeenCalledWith('message 1\n');
  });

  test('maintains correct order with mixed log levels in corked block', async () => {
    // Set threshold to debug to allow debug messages
    ioHost.logLevel = 'debug';

    await ioHost.withCorkedLogging(async () => {
      await ioHost.asIoHelper().defaults.error('error message');
      await ioHost.asIoHelper().defaults.warning('warning message');
      await ioHost.asIoHelper().defaults.debug('debug message');
    });

    const calls = mockStderr.mock.calls.map(call => call[0]);
    expect(calls).toEqual([
      'error message\n',
      'warning message\n',
      expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\] debug message\n$/),
    ]);
  });
});
