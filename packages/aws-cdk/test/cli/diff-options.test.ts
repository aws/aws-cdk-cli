import * as cdkToolkitModule from '../../lib/cli/cdk-toolkit';
import { exec } from '../../lib/cli/cli';

// Prevent actual toolkit operations
let diffSpy: jest.SpyInstance;

beforeEach(() => {
  diffSpy = jest.spyOn(cdkToolkitModule.CdkToolkit.prototype, 'diff').mockResolvedValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('diff --change-set-name', () => {
  test('passes through to CdkToolkit.diff', async () => {
    await exec(['diff', '--app', 'echo', '--change-set-name=MyCS', 'MyStack']);

    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({
      changeSetName: 'MyCS',
    }));
  });

  test('defaults to undefined', async () => {
    await exec(['diff', '--app', 'echo', 'MyStack']);

    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({
      changeSetName: undefined,
    }));
  });

  test('cannot be used with --method=template', async () => {
    await expect(
      exec(['diff', '--app', 'echo', '--method=template', '--change-set-name=MyCS', 'MyStack']),
    ).rejects.toThrow('--change-set-name cannot be used with --method=template');
  });

  test('cannot be used with --no-change-set', async () => {
    await expect(
      exec(['diff', '--app', 'echo', '--no-change-set', '--change-set-name=MyCS', 'MyStack']),
    ).rejects.toThrow('--change-set-name cannot be used with --method=template');
  });
});
