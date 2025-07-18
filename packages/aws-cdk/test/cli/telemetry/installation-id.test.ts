import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Initialize temp directory before mocking
const tempDir = path.join(os.tmpdir(), `installation-id-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

// Mock crypto.randomUUID to return predictable values
const mockRandomUUID = jest.fn();
jest.mock('crypto', () => ({
  randomUUID: mockRandomUUID,
}));

// Mock the util module to use our temp directory
const mockCdkCacheDir = jest.fn(() => tempDir);
jest.mock('../../../lib/util', () => ({
  cdkCacheDir: mockCdkCacheDir,
}));

// Now import after mocking
import type { IoHelper } from '../../../lib/api-private';
import { getInstallationId } from '../../../lib/cli/telemetry/installation-id';

describe(getInstallationId, () => {
  let mockIoHelper: IoHelper;
  let traceSpy: jest.Mock;

  beforeAll(() => {
    // Create the temp directory before any tests run
    fs.mkdirSync(tempDir, { recursive: true });
  });

  beforeEach(() => {
    // Clean the temp directory for each test
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        if (fs.statSync(filePath).isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
      }
    }

    // Mock randomUUID to return predictable values
    mockRandomUUID.mockReturnValue('12345678-1234-1234-1234-123456789abc');

    // Create mock IoHelper
    traceSpy = jest.fn();
    mockIoHelper = {
      defaults: {
        trace: traceSpy,
      },
    } as any;
  });

  afterAll(() => {
    // Clean up temp directory after all tests
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('creates new installation ID when file does not exist', async () => {
    // WHEN
    const result = await getInstallationId(mockIoHelper);

    // THEN
    expect(result).toBe('12345678-1234-1234-1234-123456789abc');
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);

    // Verify the file was created
    const installationIdPath = path.join(tempDir, 'installation-id.json');
    expect(fs.existsSync(installationIdPath)).toBe(true);
    expect(fs.readFileSync(installationIdPath, 'utf-8')).toBe('12345678-1234-1234-1234-123456789abc');

    // Should not have logged any trace messages
    expect(traceSpy).not.toHaveBeenCalled();
  });

  test('returns existing valid installation ID from file', async () => {
    // GIVEN
    const existingId = 'abcdef12-3456-7890-abcd-ef1234567890';
    const installationIdPath = path.join(tempDir, 'installation-id.json');
    fs.writeFileSync(installationIdPath, existingId);

    // WHEN
    const result = await getInstallationId(mockIoHelper);

    // THEN
    expect(result).toBe(existingId);
    expect(mockRandomUUID).not.toHaveBeenCalled();
    expect(traceSpy).not.toHaveBeenCalled();
  });

  test('creates new installation ID when existing file contains invalid UUID', async () => {
    // GIVEN
    const installationIdPath = path.join(tempDir, 'installation-id.json');
    fs.writeFileSync(installationIdPath, 'invalid-uuid');

    // WHEN
    const result = await getInstallationId(mockIoHelper);

    // THEN
    expect(result).toBe('12345678-1234-1234-1234-123456789abc');
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);

    // Verify the file was overwritten with the new ID
    expect(fs.readFileSync(installationIdPath, 'utf-8')).toBe('12345678-1234-1234-1234-123456789abc');
    expect(traceSpy).not.toHaveBeenCalled();
  });

  test('creates new installation ID when existing file is empty', async () => {
    // GIVEN
    const installationIdPath = path.join(tempDir, 'installation-id.json');
    fs.writeFileSync(installationIdPath, '');

    // WHEN
    const result = await getInstallationId(mockIoHelper);

    // THEN
    expect(result).toBe('12345678-1234-1234-1234-123456789abc');
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);
    expect(traceSpy).not.toHaveBeenCalled();
  });

  test('creates cache directory if it does not exist', async() => {
    // GIVEN
    // Remove the temp directory to test directory creation
    fs.rmSync(tempDir, { recursive: true, force: true });

    // WHEN
    const result = await getInstallationId(mockIoHelper);

    // THEN
    expect(result).toBe('12345678-1234-1234-1234-123456789abc');
    expect(fs.existsSync(tempDir)).toBe(true);

    const installationIdPath = path.join(tempDir, 'installation-id.json');
    expect(fs.existsSync(installationIdPath)).toBe(true);
    expect(traceSpy).not.toHaveBeenCalled();
  });

  test('handles file write error gracefully', async () => {
    // GIVEN
    // Make the temp directory read-only
    fs.chmodSync(tempDir, 0o444);

    // WHEN
    const result = await getInstallationId(mockIoHelper);

    // THEN
    expect(result).toBe('12345678-1234-1234-1234-123456789abc');
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);

    // Should have logged a trace message about the write failure
    expect(traceSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to write installation ID to'),
    );

    // Clean up - restore permissions so cleanup can work
    fs.chmodSync(tempDir, 0o755);
  });

  test('handles general error gracefully and returns temporary ID', async () => {
    // GIVEN
    // Mock fs.existsSync to throw an error
    const originalExistsSync = fs.existsSync;
    jest.spyOn(fs, 'existsSync').mockImplementation(() => {
      throw new Error('Filesystem error');
    });

    // WHEN
    const result = await getInstallationId(mockIoHelper);

    // THEN
    expect(result).toBe('12345678-1234-1234-1234-123456789abc');
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);

    // Should have logged a trace message about the general error
    expect(traceSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error getting installation ID:'),
    );

    // Restore original function
    (fs.existsSync as jest.Mock).mockImplementation(originalExistsSync);
  });
});
