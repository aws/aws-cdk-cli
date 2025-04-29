import type { PluginProviderResult, SDKv2CompatibleCredentials } from '@aws-cdk/cli-plugin-contract';
import { CredentialPlugins } from '../../../lib/api/aws-auth/private';
import { Mode, PluginHost } from '../../../lib/api/plugin';
import { TestIoHost } from '../../_helpers/test-io-host';

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper('deploy');

test('returns credential from plugin', async () => {
  // GIVEN
  const creds = {
    accessKeyId: 'aaa',
    secretAccessKey: 'bbb',
    getPromise: () => Promise.resolve(),
  } satisfies SDKv2CompatibleCredentials;
  const host = new PluginHost();

  host.registerCredentialProviderSource({
    name: 'Fake',

    canProvideCredentials(_accountId: string): Promise<boolean> {
      return Promise.resolve(true);
    },

    isAvailable(): Promise<boolean> {
      return Promise.resolve(true);
    },

    getProvider(_accountId: string, _mode: Mode): Promise<PluginProviderResult> {
      return Promise.resolve(creds);
    },
  });

  const plugins = new CredentialPlugins(host, ioHelper);

  // WHEN
  const pluginCredentials = await plugins.fetchCredentialsFor('aaa', Mode.ForReading);

  // THEN
  await expect(pluginCredentials?.credentials()).resolves.toEqual(expect.objectContaining({
    accessKeyId: 'aaa',
    secretAccessKey: 'bbb',
  }));
});
