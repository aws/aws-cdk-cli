
import * as deployments from '../../lib/api/deployments';
import * as logs from '../../lib/api/logs-monitor/find-cloudwatch-logs';
import { Toolkit } from '../../lib/toolkit';
import { TestIoHost, builderFixture } from '../_helpers';
import { MockSdk } from '../_helpers/mock-sdk';

let ioHost: TestIoHost;
let toolkit: Toolkit;

beforeEach(() => {
  jest.restoreAllMocks();
  ioHost = new TestIoHost();
  toolkit = new Toolkit({ ioHost });

  const sdk = new MockSdk();

  jest.spyOn(logs, 'findCloudWatchLogGroups').mockResolvedValue({
    env: { name: 'Z', account: 'X', region: 'Y' },
    sdk,
    logGroupNames: ['/aws/lambda/lambda-function-name'],
  });

  // Some default implementations
  jest.spyOn(deployments.Deployments.prototype, 'deployStack').mockResolvedValue({
    type: 'did-deploy-stack',
    stackArn: 'arn:aws:cloudformation:region:account:stack/test-stack',
    outputs: {},
    noOp: false,
  });
  jest.spyOn(deployments.Deployments.prototype, 'resolveEnvironment').mockResolvedValue({
    account: '11111111',
    region: 'aq-south-1',
    name: 'aws://11111111/aq-south-1',
  });
  jest.spyOn(deployments.Deployments.prototype, 'isSingleAssetPublished').mockResolvedValue(true);
  jest.spyOn(deployments.Deployments.prototype, 'readCurrentTemplate').mockResolvedValue({ Resources: {} });
  jest.spyOn(deployments.Deployments.prototype, 'buildSingleAsset').mockImplementation();
  jest.spyOn(deployments.Deployments.prototype, 'publishSingleAsset').mockImplementation();
});

describe('deploy with trace logs', () => {
  test('can trace logs', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    await toolkit.deploy(cx, {
      traceLogs: true,
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I5031',
      message: expect.stringContaining('The following log groups are added: /aws/lambda/lambda-function-name'),
    }));
  });
});
