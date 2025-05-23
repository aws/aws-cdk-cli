import { GetHostedZoneCommand, ListHostedZonesByNameCommand } from '@aws-sdk/client-route-53';
import type { SdkForEnvironment } from '../../lib/api/aws-auth/private';
import { SDK } from '../../lib/api/aws-auth/private';
import { HostedZoneContextProviderPlugin } from '../../lib/context-providers/hosted-zones';
import { FAKE_CREDENTIAL_CHAIN, mockRoute53Client, MockSdkProvider } from '../_helpers/mock-sdk';
import { TestIoHost } from '../_helpers/test-io-host';

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

test('get value without private zone', async () => {
  // GIVEN
  mockRoute53Client.on(ListHostedZonesByNameCommand).resolves({
    HostedZones: [{
      Id: 'foo',
      Name: 'example.com.',
      CallerReference: 'xyz',
    }],
  });

  // WHEN
  const result = await new HostedZoneContextProviderPlugin(mockSDK, mockMsg).getValue({
    domainName: 'example.com',
    account: '1234',
    region: 'rgn',
  });

  expect(result).toEqual({
    Id: 'foo',
    Name: 'example.com.',
  });
});

test('get value with private zone', async () => {
  // GIVEN
  mockRoute53Client.on(ListHostedZonesByNameCommand).resolves({
    HostedZones: [{
      Id: 'foo',
      Name: 'example.com.',
      CallerReference: 'xyz',
      Config: {
        PrivateZone: true,
      },
    }],
  });

  // WHEN
  const result = await new HostedZoneContextProviderPlugin(mockSDK, mockMsg).getValue({
    domainName: 'example.com',
    account: '1234',
    region: 'rgn',
    privateZone: true,
  });

  expect(result).toEqual({
    Id: 'foo',
    Name: 'example.com.',
  });
});

test('get value with private zone and VPC not found', async () => {
  // GIVEN
  mockRoute53Client.on(ListHostedZonesByNameCommand).resolves({
    HostedZones: [{
      Id: 'foo',
      Name: 'example.com.',
      CallerReference: 'xyz',
      Config: {
        PrivateZone: true,
      },
    }],
  });

  // No VPCs
  mockRoute53Client.on(GetHostedZoneCommand).resolves({});

  // WHEN
  const result = new HostedZoneContextProviderPlugin(mockSDK, mockMsg).getValue({
    domainName: 'example.com',
    account: '1234',
    region: 'rgn',
    privateZone: true,
    vpcId: 'vpc-bla',
  });

  await expect(result)
    .rejects
    .toThrow(new Error('Found zones: [] for dns:example.com, privateZone:true, vpcId:vpc-bla, but wanted exactly 1 zone'));
});

test('get value with private zone and VPC found', async () => {
  // GIVEN
  mockRoute53Client.on(ListHostedZonesByNameCommand).resolves({
    HostedZones: [{
      Id: 'foo',
      Name: 'example.com.',
      CallerReference: 'xyz',
      Config: {
        PrivateZone: true,
      },
    }],
  });

  mockRoute53Client.on(GetHostedZoneCommand).resolves({
    VPCs: [{
      VPCId: 'vpc-bla',
    }],
  });

  // WHEN
  const result = await new HostedZoneContextProviderPlugin(mockSDK, mockMsg).getValue({
    domainName: 'example.com',
    account: '1234',
    region: 'rgn',
    privateZone: true,
    vpcId: 'vpc-bla',
  });

  expect(result).toEqual({
    Id: 'foo',
    Name: 'example.com.',
  });
});

