import * as cdkToolkitModule from '../../lib/cli/cdk-toolkit';
import { exec } from '../../lib/cli/cli';

// Prevent actual toolkit operations
let deploySpy: jest.SpyInstance;

beforeEach(() => {
  deploySpy = jest.spyOn(cdkToolkitModule.CdkToolkit.prototype, 'deploy').mockResolvedValue();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('deploy --method=execute-change-set', () => {
  test('defaults change-set-name to cdk-deploy-change-set', async () => {
    await exec(['deploy', '--app', 'echo', '--method=execute-change-set', 'MyStack']);

    expect(deploySpy).toHaveBeenCalledWith(expect.objectContaining({
      deploymentMethod: {
        method: 'execute-change-set',
        changeSetName: 'cdk-deploy-change-set',
      },
    }));
  });

  test('requires exactly one stack', async () => {
    await expect(
      exec(['deploy', '--app', 'echo', '--method=execute-change-set', '--change-set-name=MyCS', 'Stack1', 'Stack2']),
    ).rejects.toThrow('--method=execute-change-set requires exactly one stack');
  });

  test('requires at least one stack', async () => {
    await expect(
      exec(['deploy', '--app', 'echo', '--method=execute-change-set', '--change-set-name=MyCS']),
    ).rejects.toThrow('--method=execute-change-set requires exactly one stack');
  });

  test('cannot be used with watch', async () => {
    await expect(
      exec(['deploy', '--app', 'echo', '--method=execute-change-set', '--change-set-name=MyCS', '--watch', 'MyStack']),
    ).rejects.toThrow('--method=execute-change-set cannot be used with watch');
  });

  test.each([
    ['--force', '--force'],
    ['--parameters', '--parameters', 'Foo=bar'],
    ['--import-existing-resources', '--import-existing-resources'],
    ['--revert-drift', '--revert-drift'],
  ])('rejects %s', async (_name, ...flags) => {
    await expect(
      exec(['deploy', '--app', 'echo', '--method=execute-change-set', '--change-set-name=MyCS', ...flags, 'MyStack']),
    ).rejects.toThrow('cannot be used with --method=execute-change-set');
  });

  test('passes through CdkToolkit.deploy with execute-change-set method', async () => {
    await exec(['deploy', '--app', 'echo', '--method=execute-change-set', '--change-set-name=MyCS', 'MyStack']);

    expect(deploySpy).toHaveBeenCalledWith(expect.objectContaining({
      deploymentMethod: {
        method: 'execute-change-set',
        changeSetName: 'MyCS',
      },
    }));
  });
});
