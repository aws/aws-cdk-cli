import * as cdkToolkitModule from '../../lib/cli/cdk-toolkit';
import { exec } from '../../lib/cli/cli';

// Prevent actual toolkit operations
let importSpy: jest.SpyInstance;

beforeEach(() => {
  importSpy = jest.spyOn(cdkToolkitModule.CdkToolkit.prototype, 'import').mockResolvedValue();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('import --notification-arns', () => {
  test('passes notification arns to CdkToolkit.import', async () => {
    await exec(['import', '--app', 'echo', '--notification-arns', 'arn:aws:sns:us-east-2:444455556666:MyTopic', 'MyStack']);

    expect(importSpy).toHaveBeenCalledWith(expect.objectContaining({
      notificationArns: ['arn:aws:sns:us-east-2:444455556666:MyTopic'],
    }));
  });

  test('notification arns are not set by default', async () => {
    await exec(['import', '--app', 'echo', 'MyStack']);

    expect(importSpy).toHaveBeenCalledWith(expect.objectContaining({
      notificationArns: undefined,
    }));
  });
});
