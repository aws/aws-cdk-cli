import { exec as _exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { zipDirectory } from '../../src/util/archive';

const exec = promisify(_exec);

describe('zipDirectory', () => {
  let tempDir: string;
  let outputZipPath: string;

  beforeEach(async () => {
    // Create a temporary directory
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'zipDirectory-test-'),
    );
    outputZipPath = path.join(os.tmpdir(), 'output.zip');

    // Clean up any existing test files
    try {
      await fs.promises.unlink(outputZipPath);
    } catch (e) {
      // Ignore errors if file doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.promises.rm(tempDir, { recursive: true });
      await fs.promises.unlink(outputZipPath);
    } catch (e) {
      // Ignore errors during cleanup
    }
  });

  test('creates a zip file with expected files', async () => {
    // Setup
    const testFileContent = 'test content';
    const testFilePath = path.join(tempDir, 'testfile.txt');
    await fs.promises.writeFile(testFilePath, testFileContent);

    // Create a nested directory
    const nestedDir = path.join(tempDir, 'nested');
    await fs.promises.mkdir(nestedDir, { recursive: true });
    const nestedFilePath = path.join(nestedDir, 'nestedfile.txt');
    await fs.promises.writeFile(nestedFilePath, 'nested content');

    // Act
    await zipDirectory(tempDir, outputZipPath);

    // Assert
    const stats = await fs.promises.stat(outputZipPath);
    expect(stats.isFile()).toBe(true);

    // Verify content using unzip
    const { stdout: fileList } = await exec(`unzip -l ${outputZipPath}`);

    // Check file list contains the expected files
    expect(fileList).toContain('testfile.txt');
    expect(fileList).toContain('nested/nestedfile.txt');

    // Create a temporary directory to extract files
    const extractDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'extract-test-'),
    );

    try {
      // Extract files
      await exec(`unzip ${outputZipPath} -d ${extractDir}`);

      // Verify content of files
      const mainFileContent = await fs.promises.readFile(
        path.join(extractDir, 'testfile.txt'),
        { encoding: 'utf-8' },
      );
      expect(mainFileContent).toBe(testFileContent);

      const nestedFileContent = await fs.promises.readFile(
        path.join(extractDir, 'nested/nestedfile.txt'),
        { encoding: 'utf-8' },
      );
      expect(nestedFileContent).toBe('nested content');
    } finally {
      // Clean up the extract directory
      await fs.promises.rm(extractDir, { recursive: true });
    }
  });

  test('preserves file permissions', async () => {
    // Setup - create a file with specific permissions
    const testFilePath = path.join(tempDir, 'executable.sh');
    await fs.promises.writeFile(testFilePath, '#!/bin/sh\necho "Hello"');

    // Set executable permissions (0755)
    await fs.promises.chmod(testFilePath, 0o755);

    // Act
    await zipDirectory(tempDir, outputZipPath);

    // Assert - extract the file and check permissions
    // Create a temporary directory to extract files
    const extractDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'extract-permissions-test-'),
    );

    try {
      // Extract files
      await exec(`unzip ${outputZipPath} -d ${extractDir}`);

      // Check the extracted file permissions
      const stats = await fs.promises.stat(path.join(extractDir, 'executable.sh'));

      // Check executable bit is set (0o111 = ---x--x--x)
      // eslint-disable-next-line no-bitwise
      const isExecutable = !!(stats.mode & 0o111); // Check if any executable bit is set
      expect(isExecutable).toBeTruthy();
    } finally {
      // Clean up the extract directory
      await fs.promises.rm(extractDir, { recursive: true });
    }
  });

  test('follows symlinks as expected', async () => {
    // Skip test on Windows as symlinks might not be properly supported
    if (os.platform() === 'win32') {
      return;
    }

    // Setup - create a file and a symlink to it
    const targetFile = path.join(tempDir, 'target.txt');
    await fs.promises.writeFile(targetFile, 'target content');

    const symlinkPath = path.join(tempDir, 'link.txt');
    await fs.promises.symlink(targetFile, symlinkPath);

    // Act
    await zipDirectory(tempDir, outputZipPath);

    // Assert - extract the file and check content
    // Create a temporary directory to extract files
    const extractDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'extract-symlink-test-'),
    );

    try {
      // Extract files
      await exec(`unzip ${outputZipPath} -d ${extractDir}`);

      // Check that the link.txt file exists in the zip
      const linkExists = await fs.promises.stat(path.join(extractDir, 'link.txt'))
        .then(() => true)
        .catch(() => false);
      expect(linkExists).toBeTruthy();

      // Check that the content is the same as the target file
      const linkedContent = await fs.promises.readFile(
        path.join(extractDir, 'link.txt'),
        { encoding: 'utf-8' },
      );
      expect(linkedContent).toBe('target content');
    } finally {
      // Clean up the extract directory
      await fs.promises.rm(extractDir, { recursive: true });
    }
  });
});
