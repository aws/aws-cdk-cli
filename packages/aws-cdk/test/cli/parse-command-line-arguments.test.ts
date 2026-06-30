import { parseCommandLineArguments } from '../../lib/cli/parse-command-line-arguments';

test('cdk deploy -R sets rollback to false', async () => {
  const argv = await parseCommandLineArguments(['deploy', '-R']);
  expect(argv.rollback).toBe(false);
});

test('cdk deploy --debug implies both --debug-app and --debug-cli', async () => {
  const argv = await parseCommandLineArguments(['deploy', '--debug']);
  expect(argv.debug).toBe(true);
  expect(argv.debugApp).toBe(true);
  expect(argv.debugCli).toBe(true);
});

test('cdk deploy --debug-app sets only the app debug flag', async () => {
  const argv = await parseCommandLineArguments(['deploy', '--debug-app']);
  expect(argv.debugApp).toBe(true);
  expect(argv.debug).toBe(false);
  expect(argv.debugCli).toBe(false);
});

test('cdk deploy --debug-cli sets only the cli debug flag', async () => {
  const argv = await parseCommandLineArguments(['deploy', '--debug-cli']);
  expect(argv.debugCli).toBe(true);
  expect(argv.debug).toBe(false);
  expect(argv.debugApp).toBe(false);
});

test('cdk deploy --debug does not consume the following stack argument', async () => {
  const argv = await parseCommandLineArguments(['deploy', '--debug', 'MyStack']);
  expect(argv.debug).toBe(true);
  expect(argv.STACKS).toEqual(['MyStack']);
});

test('cdk deploy without debug flags leaves them false', async () => {
  const argv = await parseCommandLineArguments(['deploy']);
  expect(argv.debug).toBe(false);
  expect(argv.debugApp).toBe(false);
  expect(argv.debugCli).toBe(false);
});

describe('cdk docs', () => {
  const originalPlatform = process.platform;
  // Helper to mock process.platform
  const mockPlatform = (platform: string) => {
    Object.defineProperty(process, 'platform', {
      value: platform,
      writable: false,
      enumerable: true,
      configurable: true,
    });
  };

  // Restore original platform after each test
  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: false,
      enumerable: true,
      configurable: true,
    });
  });

  test.each([
    ['darwin', 'open %u'],
    ['win32', 'start %u'],
    ['linux', 'xdg-open %u'],
    ['freebsd', 'xdg-open %u'],
  ])('for %s should return "%s"', async (platform, browser) => {
    mockPlatform(platform);
    const argv = await parseCommandLineArguments(['docs']);
    expect(argv.browser).toBe(browser);
  });
});

test('cdk orphan accepts positional construct paths', async () => {
  const argv = await parseCommandLineArguments(['orphan', 'MyStack/MyTable', 'MyStack/MyBucket']);
  expect(argv.PATHS).toEqual(['MyStack/MyTable', 'MyStack/MyBucket']);
});

test('cdk orphan accepts positional construct paths with --unstable=orphan', async () => {
  const argv = await parseCommandLineArguments(['orphan', '--unstable=orphan', 'MyStack/MyTable', 'MyStack/MyBucket']);
  expect(argv.PATHS).toEqual(['MyStack/MyTable', 'MyStack/MyBucket']);
  expect(argv.unstable).toEqual(['orphan']);
});
