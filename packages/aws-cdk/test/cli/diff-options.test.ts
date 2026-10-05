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

describe('diff --fail-on', () => {
  test.each(['never', 'any-change', 'broadening'])('passes --fail-on=%s through to CdkToolkit.diff', async (failOn) => {
    await exec(['diff', '--app', 'echo', `--fail-on=${failOn}`, 'MyStack']);

    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ failOn }));
  });

  test('--fail is an alias for --fail-on=any-change', async () => {
    await exec(['diff', '--app', 'echo', '--fail', 'MyStack']);

    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ failOn: 'any-change' }));
  });

  test('--no-fail is an alias for --fail-on=never', async () => {
    await exec(['diff', '--app', 'echo', '--no-fail', 'MyStack']);

    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ failOn: 'never' }));
  });

  test('defaults to never when the enableDiffNoFail feature flag is enabled', async () => {
    await exec(['diff', '--app', 'echo', '--context', 'aws-cdk:enableDiffNoFail=true', 'MyStack']);

    expect(diffSpy).toHaveBeenCalledWith(expect.objectContaining({ failOn: 'never' }));
  });

  test('can only be given once', async () => {
    await expect(
      exec(['diff', '--app', 'echo', '--fail-on=broadening', '--fail-on=any-change', 'MyStack']),
    ).rejects.toThrow('--fail-on can only be given once, got: broadening, any-change');
  });

  test.each([
    ['--fail', '--fail cannot be used with --fail-on, use --fail-on=any-change instead of --fail'],
    ['--no-fail', '--no-fail cannot be used with --fail-on, use --fail-on=never instead of --no-fail'],
  ])('cannot be used with %s', async (failFlag, message) => {
    await expect(
      exec(['diff', '--app', 'echo', failFlag, '--fail-on=broadening', 'MyStack']),
    ).rejects.toThrow(message);
  });
});
