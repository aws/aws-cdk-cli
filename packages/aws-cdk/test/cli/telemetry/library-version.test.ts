import * as fs from 'fs-extra';
import { promisify } from 'util';
import { exec } from 'child_process';
import { getLibraryVersion } from '../../../lib/cli/telemetry/library-version';
import type { IoHelper } from '../../../lib/api-private';

// Mock child_process exec
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

// Mock fs-extra
jest.mock('fs-extra', () => ({
  existsSync: jest.fn(),
  readJSONSync: jest.fn(),
}));

// Mock util promisify
jest.mock('util', () => ({
  promisify: jest.fn(),
}));

const mockExec = exec as jest.MockedFunction<typeof exec>;
const mockPromisify = promisify as jest.MockedFunction<typeof promisify>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockReadJSONSync = fs.readJSONSync as jest.MockedFunction<typeof fs.readJSONSync>;

describe('getLibraryVersion', () => {
  let mockIoHelper: IoHelper;
  let traceSpy: jest.Mock;
  let mockPromisifiedExec: jest.Mock;

  beforeEach(() => {
    // Create mock IoHelper
    traceSpy = jest.fn();
    mockIoHelper = {
      defaults: {
        trace: traceSpy,
      },
    } as any;

    // Create mock promisified exec function
    mockPromisifiedExec = jest.fn();
    mockPromisify.mockReturnValue(mockPromisifiedExec);

    // Reset all mocks
    jest.clearAllMocks();
  });

  test('returns version when aws-cdk-lib is found and package.json is valid', async () => {
    // GIVEN
    const mockLibPath = '/path/to/node_modules/aws-cdk-lib/index.js';
    const mockPackageJsonPath = '/path/to/node_modules/aws-cdk-lib/package.json';
    const expectedVersion = '2.100.0';

    mockPromisifiedExec.mockResolvedValue({ stdout: mockLibPath });
    mockExistsSync.mockReturnValue(true);
    mockReadJSONSync.mockReturnValue({ version: expectedVersion });

    // WHEN
    const result = await getLibraryVersion(mockIoHelper);

    // THEN
    expect(result).toBe(expectedVersion);
    expect(mockPromisify).toHaveBeenCalledWith(mockExec);
    expect(mockPromisifiedExec).toHaveBeenCalledWith("node -e 'console.log(require.resolve(\"aws-cdk-lib\"))'");
    expect(mockExistsSync).toHaveBeenCalledWith(mockLibPath);
    expect(mockReadJSONSync).toHaveBeenCalledWith(mockPackageJsonPath);
    expect(traceSpy).not.toHaveBeenCalled();
  });

  test('returns undefined and logs trace when resolved path does not exist', async () => {
    // GIVEN
    const mockLibPath = '/nonexistent/path/to/aws-cdk-lib/index.js';
    mockPromisifiedExec.mockResolvedValue({ stdout: mockLibPath });
    mockExistsSync.mockReturnValue(false);

    // WHEN
    const result = await getLibraryVersion(mockIoHelper);

    // THEN
    expect(result).toBeUndefined();
    expect(mockExistsSync).toHaveBeenCalledWith(mockLibPath);
    expect(mockReadJSONSync).not.toHaveBeenCalled();
    expect(traceSpy).toHaveBeenCalledWith(
      'Could not get CDK Library Version: require.resolve("aws-cdk-lib") did not return a file path'
    );
  });

  test('returns undefined and logs trace when exec command fails', async () => {
    // GIVEN
    const execError = new Error('Command failed: node -e ...');
    mockPromisifiedExec.mockRejectedValue(execError);

    // WHEN
    const result = await getLibraryVersion(mockIoHelper);

    // THEN
    expect(result).toBeUndefined();
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockReadJSONSync).not.toHaveBeenCalled();
    expect(traceSpy).toHaveBeenCalledWith(`Could not get CDK Library Version: ${execError}`);
  });

  test('handles package.json without version field', async () => {
    // GIVEN
    const mockLibPath = '/path/to/node_modules/aws-cdk-lib/index.js';
    mockPromisifiedExec.mockResolvedValue({ stdout: mockLibPath });
    mockExistsSync.mockReturnValue(true);
    mockReadJSONSync.mockReturnValue({ name: 'aws-cdk-lib' }); // No version field

    // WHEN
    const result = await getLibraryVersion(mockIoHelper);

    // THEN
    expect(result).toBeUndefined();
    expect(traceSpy).toHaveBeenCalledWith('Could not get CDK Library Version: package.json does not have verision field');
  });
});
