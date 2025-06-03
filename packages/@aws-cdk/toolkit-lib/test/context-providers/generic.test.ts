/* eslint-disable import/order */
import { PluginHost } from '../../lib/api/plugin';
import * as contextproviders from '../../lib/context-providers';
import { TRANSIENT_CONTEXT_KEY } from '../../lib/api/context';
import { MockSdkProvider, setDefaultSTSMocks } from '../_helpers/mock-sdk';
import { TestIoHost } from '../_helpers/test-io-host';
import { ToolkitError } from '../../lib';

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper();

const mockSDK = new MockSdkProvider();
setDefaultSTSMocks();

const TEST_PROVIDER: any = 'testprovider';
const PLUGIN_PROVIDER: any = 'plugin';

test('errors are reported into the context value', async () => {
  // GIVEN
  contextproviders.registerContextProvider(TEST_PROVIDER, {
    async getValue(_: { [key: string]: any }): Promise<any> {
      throw new Error('Something went wrong');
    },
  });

  // WHEN
  const result = await contextproviders.provideContextValues([
    { key: 'asdf', props: { account: '1234', region: 'us-east-1' }, provider: TEST_PROVIDER },
  ], mockSDK, new PluginHost(), ioHelper);

  // THEN - error is now in context

  // NOTE: error key is inlined here because it's part of the CX-API
  // compatibility surface.
  expect((result.asdf as any).$providerError).toBe('Something went wrong');
});

test('lookup role ARN is resolved', async () => {
  // GIVEN
  contextproviders.registerContextProvider(TEST_PROVIDER, {
    async getValue(args: { [key: string]: any }): Promise<any> {
      if (args.lookupRoleArn == null) {
        throw new Error('No lookupRoleArn');
      }

      if (args.lookupRoleArn.includes('${AWS::Partition}')) {
        throw new Error('Partition not resolved');
      }

      return 'some resolved value';
    },
  });

  // WHEN
  const result = await contextproviders.provideContextValues([
    {
      key: 'asdf',
      props: {
        account: '1234',
        region: 'us-east-1',
        lookupRoleArn: 'arn:${AWS::Partition}:iam::280619947791:role/cdk-hnb659fds-lookup-role-280619947791-us-east-1',
      },
      provider: TEST_PROVIDER,
    },
  ], mockSDK, new PluginHost(), ioHelper);

  // THEN - Value gets resolved
  expect(result.asdf).toEqual('some resolved value');
});

test('errors are marked transient', async () => {
  // GIVEN
  contextproviders.registerContextProvider(TEST_PROVIDER, {
    async getValue(_: { [key: string]: any }): Promise<any> {
      throw new Error('Something went wrong');
    },
  });

  // WHEN
  const result = await contextproviders.provideContextValues([
    { key: 'asdf', props: { account: '1234', region: 'us-east-1' }, provider: TEST_PROVIDER },
  ], mockSDK, new PluginHost(), ioHelper);

  // THEN - error is marked transient
  expect((result.asdf as any)[TRANSIENT_CONTEXT_KEY]).toBeTruthy();
});

test('toolkit errors with cause are displayed fully', async () => {
  // GIVEN
  contextproviders.registerContextProvider(TEST_PROVIDER, {
    async getValue(_: { [key: string]: any }): Promise<any> {
      throw ToolkitError.withCause('Something went wrong', new Error('And this is the reason'));
    },
  });

  // WHEN
  const result = await contextproviders.provideContextValues([
    { key: 'asdf', props: { account: '1234', region: 'us-east-1' }, provider: TEST_PROVIDER },
  ], mockSDK, new PluginHost(), ioHelper);

  // THEN - error is marked transient
  expect((result.asdf as any).$providerError).toBe('Something went wrong\nAnd this is the reason');
});

test('context provider can be registered using PluginHost', async () => {
  let called = false;

  // GIVEN
  const ph = new PluginHost();
  ph.registerContextProviderAlpha('prov', {
    async getValue(_: { [key: string]: any }): Promise<any> {
      called = true;
      return '';
    },
  });

  // WHEN
  await contextproviders.provideContextValues([
    { key: 'asdf', props: { account: '1234', region: 'us-east-1', pluginName: 'prov' }, provider: PLUGIN_PROVIDER },
  ], mockSDK, ph, ioHelper);

  // THEN - error is marked transient
  expect(called).toEqual(true);
});

test('plugin context provider can be called without account/region', async () => {
  // GIVEN
  const ph = new PluginHost();
  ph.registerContextProviderAlpha('prov', {
    async getValue(_: { [key: string]: any }): Promise<any> {
      return 'yay';
    },
  });

  // WHEN
  const result = await contextproviders.provideContextValues([
    { key: 'asdf', props: { banana: 'yellow', pluginName: 'prov' } as any, provider: PLUGIN_PROVIDER },
  ], mockSDK, ph, ioHelper);

  // THEN - error is marked transient
  expect(result.asdf).toEqual('yay');
});
