import { exec } from '../../lib/cli/cli';
import { CliIoHost } from '../../lib/cli/io-host';

const notifySpy = jest.spyOn(CliIoHost.prototype, 'notify');

jest.mock('@aws-cdk/cx-api');
jest.mock('../../lib/cli/platform-warnings', () => ({
  checkForPlatformWarnings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/api/notices', () => ({
  Notices: {
    create: jest.fn().mockReturnValue({
      refresh: jest.fn().mockResolvedValue(undefined),
      display: jest.fn(),
    }),
  },
}));

describe('doctor', () => {
  test('prints CDK version', async () => {
    await exec(['doctor']);
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', message: expect.stringContaining('CDK Version:') }));
  });
});

describe('docs', () => {
  test('prints docs url version', async () => {
    await exec(['docs', '-b "echo %u"']);
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', message: expect.stringContaining('https://docs.aws.amazon.com/cdk/api/v2/') }));
  });
});

// describe('context', () => {
//   test('prints note about empty context', async () => {
//     await exec(['context']);
//     expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', message: expect.stringContaining('This CDK application does not have any saved context values yet.') }));
//   });
// });

describe('cli-telemetry', () => {
  test('requires a flag to be set', async () => {
    await expect(exec(['cli-telemetry']))
      .rejects
      .toThrow("Must specify '--enable', '--disable', or '--status'");
  });
});
