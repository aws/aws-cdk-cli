import { parseCommandLineArguments } from '../../lib/cli/parse-command-line-arguments';

test('cdk deploy -R sets rollback to false', async () => {
  const argv = await parseCommandLineArguments(['deploy', '-R']);
  expect(argv.rollback).toBe(false);
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

describe('cdk init', () => {
  test.each([
    ['csharp', 'csharp'],
    ['cs', 'csharp'],
    ['fsharp', 'fsharp'],
    ['fs', 'fsharp'],
    ['go', 'go'],
    ['java', 'java'],
    ['javascript', 'javascript'],
    ['js', 'javascript'],
    ['python', 'python'],
    ['py', 'python'],
    ['typescript', 'typescript'],
    ['ts', 'typescript'],
  ])('return %l when %l set in cdk init --language', async (lang, completeLang) => {
    const [argv, argvForAlias] = await Promise.all([
      parseCommandLineArguments(['init', '--language', lang]),
      parseCommandLineArguments(['init', '-l', lang]),
    ]);
    expect(argv.language).toBe(completeLang);
    expect(argvForAlias.language).toBe(completeLang);
  });
});
