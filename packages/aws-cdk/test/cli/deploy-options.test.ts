import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
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

describe('watch stack outputs', () => {
  test.each(['--outputs-file', '-O'])('accepts %s', async (flag) => {
    const watchSpy = jest.spyOn(cdkToolkitModule.CdkToolkit.prototype, 'watch').mockResolvedValue();

    await exec(['watch', '--app', 'echo', flag, 'outputs.json', 'MyStack']);

    expect(watchSpy).toHaveBeenCalledWith(expect.objectContaining({ outputsFile: 'outputs.json' }));
  });

  test.each([[], ['--outputs-file', 'override.json']])('reads project settings with flags %j', async (...flags) => {
    const watchSpy = jest.spyOn(cdkToolkitModule.CdkToolkit.prototype, 'watch').mockResolvedValue();
    const oldDir = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-watch-outputs-'));
    try {
      fs.writeJsonSync(path.join(tempDir, 'cdk.json'), { app: 'echo', outputsFile: 'configured-outputs.json' });
      process.chdir(tempDir);

      await exec(['watch', ...flags, 'MyStack']);

      expect(watchSpy).toHaveBeenCalledWith(expect.objectContaining({
        outputsFile: flags.length > 0 ? 'override.json' : 'configured-outputs.json',
      }));
    } finally {
      process.chdir(oldDir);
      fs.removeSync(tempDir);
    }
  });
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

describe('deploy rollback triggers', () => {
  test('--rollback-trigger-alarm-arns builds a rollback configuration', async () => {
    await exec(['deploy', '--app', 'echo', '--rollback-trigger-alarm-arns', 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:MyAlarm', 'MyStack']);

    expect(deploySpy).toHaveBeenCalledWith(expect.objectContaining({
      rollbackConfiguration: {
        triggers: [{ arn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:MyAlarm' }],
        monitoringTimeInMinutes: undefined,
      },
    }));
  });

  test('--monitoring-time-minutes is carried alongside the alarm arns', async () => {
    await exec(['deploy', '--app', 'echo', '--rollback-trigger-alarm-arns', 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:MyAlarm', '--monitoring-time-minutes', '30', 'MyStack']);

    expect(deploySpy).toHaveBeenCalledWith(expect.objectContaining({
      rollbackConfiguration: {
        triggers: [{ arn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:MyAlarm' }],
        monitoringTimeInMinutes: 30,
      },
    }));
  });

  test('neither flag leaves the rollback configuration unmanaged', async () => {
    await exec(['deploy', '--app', 'echo', 'MyStack']);

    expect(deploySpy).toHaveBeenCalledWith(expect.objectContaining({
      rollbackConfiguration: undefined,
    }));
  });

  test('--rollback-trigger-alarm-arns none clears the rollback configuration', async () => {
    await exec(['deploy', '--app', 'echo', '--rollback-trigger-alarm-arns', 'none', 'MyStack']);

    expect(deploySpy).toHaveBeenCalledWith(expect.objectContaining({
      rollbackConfiguration: {
        triggers: [],
        monitoringTimeInMinutes: undefined,
      },
    }));
  });

  test('--monitoring-time-minutes without --rollback-trigger-alarm-arns is rejected', async () => {
    await expect(
      exec(['deploy', '--app', 'echo', '--monitoring-time-minutes', '30', 'MyStack']),
    ).rejects.toThrow('--monitoring-time-minutes requires --rollback-trigger-alarm-arns');

    expect(deploySpy).not.toHaveBeenCalled();
  });
});

describe('deploy --express', () => {
  test('passes express: true to CdkToolkit.deploy', async () => {
    await exec(['deploy', '--app', 'echo', '--express', 'MyStack']);

    expect(deploySpy).toHaveBeenCalledWith(expect.objectContaining({
      express: true,
    }));
  });

  test('express defaults to false', async () => {
    await exec(['deploy', '--app', 'echo', 'MyStack']);

    expect(deploySpy).toHaveBeenCalledWith(expect.objectContaining({
      express: false,
    }));
  });
});
