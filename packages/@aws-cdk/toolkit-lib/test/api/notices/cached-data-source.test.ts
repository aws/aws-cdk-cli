import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { asIoHelper } from '../../../lib/api/io/private';
import { CachedDataSource } from '../../../lib/api/notices/cached-data-source';
import { TestIoHost } from '../../_helpers';

describe('CachedDataSource', () => {
  const ioHost = new TestIoHost('trace');
  const ioHelper = asIoHelper(ioHost, 'notices' as any);
  let tempDir: string;
  let cacheFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-test-'));
    cacheFilePath = path.join(tempDir, 'nonexistent-dir', 'cache.json');

    // Just to be sure, remove directory if it exists
    const dirPath = path.dirname(cacheFilePath);
    if (fs.existsSync(dirPath)) {
      fs.rmdirSync(dirPath, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmdirSync(tempDir, { recursive: true });
  });

  test('ensures directory exists when saving cache file', async () => {
    // GIVEN
    const mockDataSource = {
      fetch: jest.fn().mockResolvedValue([{ title: 'Test Notice' }]),
    };
    const dataSource = new CachedDataSource(ioHelper, cacheFilePath, mockDataSource);

    // WHEN
    await dataSource.fetch();

    // THEN
    // Directory should have been created
    expect(fs.existsSync(path.dirname(cacheFilePath))).toBe(true);
    // Cache file should exist
    expect(fs.existsSync(cacheFilePath)).toBe(true);
    // Cache file should contain the fetched data
    const cachedContent = fs.readJSONSync(cacheFilePath);
    expect(cachedContent).toHaveProperty('notices');
    expect(cachedContent.notices).toEqual([{ title: 'Test Notice' }]);
  });

  test('handles errors when ensuring directory exists', async () => {
    // GIVEN
    const mockDataSource = {
      fetch: jest.fn().mockResolvedValue([{ title: 'Test Notice' }]),
    };

    // Mock fs.ensureFile to throw an error
    jest.spyOn(fs, 'ensureFile').mockImplementationOnce(() => {
      throw new Error('Failed to create directory');
    });

    const dataSource = new CachedDataSource(ioHelper, cacheFilePath, mockDataSource);

    // WHEN
    await dataSource.fetch();

    // THEN
    // Should have logged the error
    ioHost.expectMessage({
      level: 'debug',
      containing: 'Failed to store notices in the cache: Error: Failed to create directory',
    });

    // Should still return data from the source
    expect(mockDataSource.fetch).toHaveBeenCalled();
  });
});
