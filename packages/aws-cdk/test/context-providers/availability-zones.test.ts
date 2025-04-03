import { DescribeAvailabilityZonesCommand } from '@aws-sdk/client-ec2';
import { SDK, SdkForEnvironment } from '../../lib/api';
import { AZContextProviderPlugin } from '../../lib/context-providers/availability-zones';
import { FAKE_CREDENTIAL_CHAIN, mockEC2Client, MockSdkProvider } from '../util/mock-sdk';
import { TestIoHost } from '../../../@aws-cdk/tmp-toolkit-helpers/src/api/io/private';

const mockSDK = new (class extends MockSdkProvider {
  public forEnvironment(): Promise<SdkForEnvironment> {
    return Promise.resolve({ sdk: new SDK(FAKE_CREDENTIAL_CHAIN, mockSDK.defaultRegion, {}, new TestIoHost().asHelper("deploy")), didAssumeRole: false });
  }
})();

const mockMsg = {
  debug: jest.fn(),
  info: jest.fn(),
};

beforeEach(() => {
  mockMsg.debug.mockClear();
  mockMsg.info.mockClear();
});

test('empty array as result when response has no AZs', async () => {
  // GIVEN
  mockEC2Client.on(DescribeAvailabilityZonesCommand).resolves({
    AvailabilityZones: undefined,
  });

  // WHEN
  const azs = await new AZContextProviderPlugin(mockSDK, mockMsg).getValue({
    account: '1234',
    region: 'asdf',
  });

  // THEN
  expect(azs).toEqual([]);
});

test('returns AZs', async () => {
  // GIVEN
  mockEC2Client.on(DescribeAvailabilityZonesCommand).resolves({
    AvailabilityZones: [{
      ZoneName: 'us-east-1a',
      State: 'available',
    }],
  });

  // WHEN
  const azs = await new AZContextProviderPlugin(mockSDK, mockMsg).getValue({
    account: '1234',
    region: 'asdf',
  });

  // THEN
  expect(azs).toEqual(['us-east-1a']);
});
