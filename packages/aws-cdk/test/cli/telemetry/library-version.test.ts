import * as fs from 'fs-extra';
import type { IoHelper } from '../../../lib/api-private';
import { getLibraryVersion } from '../../../lib/cli/telemetry/library-version';

// Mock the subprocess tool's run()
jest.mock('@aws-cdk/private-tools/lib/subprocess', () => ({
  run: jest.fn(),
}));

// Mock fs-extra
jest.mock('fs-extra', () => ({
  existsSync: jest.fn(),
  readJSONSync: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { run: mockRun } = require('@aws-cdk/private-tools/lib/subprocess');
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockReadJSONSync = fs.readJSONSync as jest.MockedFunction<typeof fs.readJSONSync>;

describe('getLibraryVersion', () => {
  let mockIoHelper: IoHelper;
  let traceSpy: jest.Mock;

  beforeEach(() => {
    traceSpy = jest.fn();
    mockIoHelper = {
      defaults: {
        trace: traceSpy,
      },
    } as any;

    jest.clearAllMocks();
  });

  test('returns version when aws-cdk-lib is found and package.json is valid', async () => {
    const mockLibPath = '/path/to/node_modules/aws-cdk-lib/index.js';
    const mockPackageJsonPath = '/path/to/node_modules/aws-cdk-lib/package.json';
    const expectedVersion = '2.100.0';

    mockRun.mockResolvedValue({ stdout: mockLibPath, stderr: '' });
    mockExistsSync.mockReturnValue(true);
    mockReadJSONSync.mockReturnValue({ version: expectedVersion });

    const result = await getLibraryVersion(mockIoHelper);

    expect(result).toBe(expectedVersion);
    expect(mockRun).toHaveBeenCalledWith([process.execPath, '-e', 'process.stdout.write(require.resolve("aws-cdk-lib"))']);
    expect(mockExistsSync).toHaveBeenCalledWith(mockLibPath);
    expect(mockReadJSONSync).toHaveBeenCalledWith(mockPackageJsonPath);
    expect(traceSpy).not.toHaveBeenCalled();
  });

  test('returns undefined and logs trace when resolved path does not exist', async () => {
    const mockLibPath = '/nonexistent/path/to/aws-cdk-lib/index.js';
    mockRun.mockResolvedValue({ stdout: mockLibPath, stderr: '' });
    mockExistsSync.mockReturnValue(false);

    const result = await getLibraryVersion(mockIoHelper);

    expect(result).toBeUndefined();
    expect(mockExistsSync).toHaveBeenCalledWith(mockLibPath);
    expect(mockReadJSONSync).not.toHaveBeenCalled();
    expect(traceSpy).toHaveBeenCalledWith(
      'Could not get CDK Library Version: require.resolve("aws-cdk-lib") did not return a file path',
    );
  });

  test('returns undefined and logs trace when run() throws', async () => {
    const runError = new Error('spawn ENOENT');
    mockRun.mockRejectedValue(runError);

    const result = await getLibraryVersion(mockIoHelper);

    expect(result).toBeUndefined();
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockReadJSONSync).not.toHaveBeenCalled();
    expect(traceSpy).toHaveBeenCalledWith(`Could not get CDK Library Version: ${runError}`);
  });

  test('handles package.json without version field', async () => {
    const mockLibPath = '/path/to/node_modules/aws-cdk-lib/index.js';
    mockRun.mockResolvedValue({ stdout: mockLibPath, stderr: '' });
    mockExistsSync.mockReturnValue(true);
    mockReadJSONSync.mockReturnValue({ name: 'aws-cdk-lib' });

    const result = await getLibraryVersion(mockIoHelper);

    expect(result).toBeUndefined();
    expect(traceSpy).toHaveBeenCalledWith('Could not get CDK Library Version: package.json does not have version field');
  });
});
