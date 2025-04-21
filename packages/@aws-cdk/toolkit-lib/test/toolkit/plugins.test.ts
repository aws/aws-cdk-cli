import type { PluginProviderResult } from '@aws-cdk/cli-plugin-contract';
import { StackSelectionStrategy } from '../../lib';
import { SdkProvider } from '../../lib/api/shared-private';
import { Toolkit } from '../../lib/toolkit/toolkit';
import { appFixture, TestIoHost } from '../_helpers';
import { MockSdk } from '../_helpers/mock-sdk';

test('two toolkit instances have independent plugin hosts by default', () => {
  // GIVEN
  const toolkit1 = new Toolkit();
  const toolkit2 = new Toolkit();

  // WHEN
  toolkit1.pluginHost.registerCredentialProviderSource({
    name: 'test',
    isAvailable: () => Promise.resolve(false),
    canProvideCredentials: () => Promise.resolve(false),
    getProvider: () => Promise.reject('should not be called'),
  });

  // THEN
  expect(toolkit1.pluginHost.credentialProviderSources.length).toEqual(1);
  expect(toolkit2.pluginHost.credentialProviderSources.length).toEqual(0);
});

test('credential plugins registered into toolkit are queried', async () => {
  // GIVEN
  const toolkit = new Toolkit({
    ioHost: new TestIoHost(),
  });

  const canProvideCredentials = jest.fn().mockResolvedValue(true);
  const getProvider = jest.fn().mockResolvedValue({
    accessKeyId: 'a',
    secretAccessKey: 's',
  } satisfies PluginProviderResult);

  toolkit.pluginHost.registerCredentialProviderSource({
    name: 'test plugin',
    isAvailable: () => Promise.resolve(true),
    canProvideCredentials,
    getProvider,
  });

  const mockSdk = jest.spyOn(SdkProvider.prototype, '_makeSdk').mockReturnValue(new MockSdk());

  // WHEN - simplest API that uses some credentials
  const cx = await appFixture(toolkit, 'stack-with-defined-env');
  // We expect this to fail because we didn't really put in the effort to make the mocks return
  // something sensible.
  await expect(toolkit.rollback(cx, {
    stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
  })).rejects.toThrow();

  // THEN
  expect(canProvideCredentials).toHaveBeenCalled();
  expect(getProvider).toHaveBeenCalledWith('11111111111', 0, expect.anything());

  mockSdk.mockRestore();
});
