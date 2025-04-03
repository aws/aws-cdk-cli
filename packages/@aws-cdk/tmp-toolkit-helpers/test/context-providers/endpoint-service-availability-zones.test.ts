import { DescribeVpcEndpointServicesCommand } from '@aws-sdk/client-ec2';
import type { SdkForEnvironment } from '../../src/api';
import { SDK } from '../../src/api';
import {
  EndpointServiceAZContextProviderPlugin,
} from '../../src/context-providers/endpoint-service-availability-zones';
import { TestIoHost } from '../_helpers/io-host';
import { FAKE_CREDENTIAL_CHAIN, mockEC2Client, MockSdkProvider } from '../_helpers/mock-sdk';

const mockSDK = new (class extends MockSdkProvider {
  public forEnvironment(): Promise<SdkForEnvironment> {
    return Promise.resolve({ sdk: new SDK(FAKE_CREDENTIAL_CHAIN, mockSDK.defaultRegion, {}, new TestIoHost().asHelper('deploy')), didAssumeRole: false });
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

test('empty result when service details cannot be retrieved', async () => {
  // GIVEN
  mockEC2Client.on(DescribeVpcEndpointServicesCommand).resolves({});

  // WHEN
  const result = await new EndpointServiceAZContextProviderPlugin(mockSDK, mockMsg).getValue({
    serviceName: 'svc',
    account: 'foo',
    region: 'rgn',
  });

  expect(result).toEqual([]);
});

test('returns availability zones', async () => {
  // GIVEN
  mockEC2Client.on(DescribeVpcEndpointServicesCommand).resolves({
    ServiceDetails: [{
      AvailabilityZones: ['us-east-1a'],
    }],
  });

  // WHEN
  const result = await new EndpointServiceAZContextProviderPlugin(mockSDK, mockMsg).getValue({
    serviceName: 'svc',
    account: 'foo',
    region: 'rgn',
  });

  expect(result).toEqual(['us-east-1a']);
});
