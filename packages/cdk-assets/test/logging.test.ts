/* eslint-disable no-console */
import { spawn } from 'child_process';
import * as path from 'path';
import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import mockfs from './mock-fs';
import type { LogLevel } from '../bin/logging';
import { setLogThreshold, log } from '../bin/logging';

// 20s - some longer running tests
jest.setTimeout(20_000);

describe('Logging System', () => {
  let consoleErrorSpy: jest.SpyInstance;
  const originalConsoleError = console.error;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    console.error = originalConsoleError;
  });

  describe('log threshold behavior', () => {
    test('only logs messages at or above the threshold level', () => {
      setLogThreshold('info');

      log('verbose', 'Verbose message');
      log('info', 'Info message');
      log('error', 'Error message');

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Verbose message'));

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Info message'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error message'));
    });

    test('logs all messages when threshold is verbose', () => {
      setLogThreshold('verbose');

      log('verbose', 'Verbose message');
      log('info', 'Info message');
      log('error', 'Error message');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Verbose message'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Info message'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error message'));
    });

    test('logs only errors when threshold is error', () => {
      setLogThreshold('error');

      log('verbose', 'Verbose message');
      log('info', 'Info message');
      log('error', 'Error message');

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Verbose message'));
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Info message'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error message'));
    });
  });

  describe('log formatting', () => {
    test('pads log level names consistently', () => {
      setLogThreshold('verbose');

      log('error', 'Error message');
      log('info', 'Info message');
      log('verbose', 'Verbose message');

      const calls = consoleErrorSpy.mock.calls;

      calls.forEach((call) => {
        const logMessage = call[0] as string;
        const levelPart = logMessage.split(':')[0];
        expect(levelPart.length).toBe(7);
      });
    });
  });

  describe('invalid usage', () => {
    test('handles invalid log levels gracefully', () => {
      setLogThreshold('info');

      log('invalid' as LogLevel, 'Invalid level message');

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
  describe('log level transitions', () => {
    test('handles dynamic threshold changes', () => {
      setLogThreshold('verbose');
      log('verbose', 'Initial verbose message');

      setLogThreshold('info');
      log('verbose', 'Should not appear');
      log('info', 'Should appear');

      setLogThreshold('error');
      log('info', 'Should not appear');
      log('error', 'Should appear');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Initial verbose message'),
      );
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Should not appear'),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Should appear'));
    });

    test('maintains message integrity across level changes', () => {
      const message = 'A'.repeat(1000);

      setLogThreshold('verbose');
      log('verbose', message);

      setLogThreshold('error');
      log('error', message);

      const calls = consoleErrorSpy.mock.calls;
      calls.forEach((call) => {
        const logMessage = call[0] as string;
        expect(logMessage).toContain(message);
      });
    });
  });
});

describe('CLI Logging Integration', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [],
    });

    mockfs({
      '/test/assets.json': JSON.stringify({
        version: Manifest.version(),
        files: {
          asset1: {
            source: {
              path: 'some_file',
            },
            destinations: {
              dest1: {
                bucketName: 'test-bucket',
                objectKey: 'test-key',
                region: 'us-east-1',
              },
            },
          },
        },
      }),
      '/test/some_file': 'test content',
    });
  });

  afterEach(() => {
    mockfs.restore();
  });

  function runCli(
    args: string[],
  ): Promise<{ stdout: string; stderr: string; combinedOutput: string[] }> {
    return new Promise((resolve, reject) => {
      const cliPath = path.resolve(__dirname, '../bin/cdk-assets');
      // dummy credentials
      const env = {
        ...process.env,
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
        AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      };

      const child = spawn('node', [cliPath, ...args], { env });

      let stdout = '';
      let stderr = '';
      const combinedOutput: string[] = [];

      child.stdout.on('data', (data) => {
        const str = data.toString();
        stdout += str;
        combinedOutput.push(str);
      });

      child.stderr.on('data', (data) => {
        const str = data.toString();
        stderr += str;
        combinedOutput.push(str);
      });

      child.on('close', () => {
        resolve({ stdout, stderr, combinedOutput });
      });

      child.on('error', reject);
    });
  }

  test('handles list command with default logging', async () => {
    const { combinedOutput } = await runCli(['ls', '-p', mockfs.path('/test')]);

    const output = combinedOutput.join('');
    expect(output).toContain('asset1');
  });

  test('shows verbose output with single -v flag', async () => {
    const { combinedOutput } = await runCli(['publish', '-v', '-p', mockfs.path('/test')]);

    const output = combinedOutput.join('');
    expect(output).toContain('verbose: ');
  });

  test('shows increased verbosity with multiple verbose flags', async () => {
    const { combinedOutput } = await runCli(['publish', '-vv', '-p', mockfs.path('/test')]);

    const output = combinedOutput.join('');
    const verboseCount = (output.match(/verbose: /g) || []).length;
    expect(verboseCount).toBeGreaterThan(1);
  });

  test('shows help output correctly', async () => {
    const { stdout } = await runCli(['--help']);

    expect(stdout).toContain('cdk-assets <cmd>');
    expect(stdout).toContain('[args]');
    expect(stdout).toContain('Commands:');
    expect(stdout).toContain('Options:');
  });

  test('shows error for invalid path', async () => {
    const { stderr } = await runCli(['ls', '-p', '/invalid/path']);
    expect(stderr).toContain('Error');
  });

  test('handles publish command progress output', async () => {
    const { combinedOutput } = await runCli(['publish', '-p', mockfs.path('/test')]);

    const output = combinedOutput.join('');
    expect(output).toMatch(/\[\d+%\]/);
    expect(output).toContain('Publishing');
  });

  test('shows different log levels appropriately', async () => {
    const { combinedOutput } = await runCli(['publish', '-v', '-p', mockfs.path('/test')]);

    const output = combinedOutput.join('');
    expect(output).toContain('verbose: ');
    expect(output).toContain('info   : ');
  });

  test('command version output', async () => {
    const { stdout } = await runCli(['--version']);
    expect(stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
  });
});
