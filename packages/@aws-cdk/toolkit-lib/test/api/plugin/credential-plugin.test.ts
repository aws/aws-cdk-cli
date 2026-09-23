import type { CredentialProviderSource, SDKv3CompatibleCredentials } from '@aws-cdk/cli-plugin-contract';
import { CredentialPlugins, credentialsAboutToExpire } from '../../../lib/api/aws-auth/private';
import { Mode, PluginHost } from '../../../lib/api/plugin';
import { TestIoHost } from '../../_helpers/test-io-host';

let host: PluginHost;
let credentialPlugins: CredentialPlugins;

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper('deploy');

beforeEach(() => {
  host = new PluginHost();
  credentialPlugins = new CredentialPlugins(host, ioHelper);
  jest.resetModules();
  jest.useFakeTimers();
});

const THE_PLUGIN = 'the-plugin';

test('plugin can return V3 compatible credentials', async () => {
  // GIVEN
  mockCredentialFunction(() => Promise.resolve({
    accessKeyId: 'keyid',
    secretAccessKey: 'secret',
  }));

  // WHEN
  const creds = await fetchNow();

  await expect(creds).toEqual(expect.objectContaining({
    accessKeyId: 'keyid',
  }));
});

test('plugin can return V3 compatible credentials that expire', async () => {
  // GIVEN
  const mockProducer = jest.fn().mockImplementation(() => Promise.resolve({
    accessKeyId: 'keyid',
    secretAccessKey: 'secret',
    sessionToken: 'session',
    expiration: new Date(Date.now() + 300_000), // 5 minutes from now
  } satisfies SDKv3CompatibleCredentials));
  mockCredentialFunction(mockProducer);

  // WHEN
  await fetchNow();
  await fetchNow();
  expect(mockProducer).toHaveBeenCalledTimes(1); // Caching

  jest.advanceTimersByTime(300_000); // 5 minutes into the future we go
  await fetchNow();
  expect(mockProducer).toHaveBeenCalledTimes(2); // Cache busted
});

test('provider returning expiring credentials must keep returning the same object type', async () => {
  // GIVEN
  const mockProducer = jest.fn()
    .mockImplementationOnce(() => Promise.resolve({
      accessKeyId: 'keyid',
      secretAccessKey: 'secret',
      sessionToken: 'session',
      expiration: new Date(Date.now() + 300_000), // 5 minutes from now
    } satisfies SDKv3CompatibleCredentials))
    .mockImplementationOnce(() => Promise.resolve(() => Promise.resolve({ accessKeyId: 'akid' })));
  mockCredentialFunction(mockProducer);

  // WHEN
  await fetchNow();
  jest.advanceTimersByTime(300_000); // Make the credentials expire
  await expect(fetchNow()).rejects.toThrow(/Plugin initially returned static V3/);
});

test('plugin can return V3 compatible credential-provider', async () => {
  // GIVEN
  mockCredentialFunction(() => Promise.resolve(() => Promise.resolve({
    accessKeyId: 'keyid',
    secretAccessKey: 'secret',
  })));

  // WHEN
  const creds = await fetchNow();

  await expect(creds).toEqual(expect.objectContaining({
    accessKeyId: 'keyid',
  }));
});

test('plugin can return V2 compatible credential-provider', async () => {
  // GIVEN
  let getPromise = jest.fn().mockResolvedValue(undefined);

  mockCredentialFunction(() => Promise.resolve({
    accessKeyId: 'keyid',
    secretAccessKey: 'secret',
    expired: false,
    getPromise,
  }));

  // WHEN
  const creds = await fetchNow();

  await expect(creds).toEqual(expect.objectContaining({
    accessKeyId: 'keyid',
  }));
  expect(getPromise).toHaveBeenCalled();
});

test('plugin can return V2 compatible credential-provider with initially empty keys', async () => {
  // GIVEN
  mockCredentialFunction(() => Promise.resolve({
    accessKeyId: '',
    secretAccessKey: '',
    expired: false,
    getPromise() {
      this.accessKeyId = 'keyid';
      return Promise.resolve({});
    },
  }));

  // WHEN
  const creds = await fetchNow();

  await expect(creds).toEqual(expect.objectContaining({
    accessKeyId: 'keyid',
  }));
});

test('plugin must not return something that is not a credential', async () => {
  // GIVEN
  mockCredentialFunction(() => Promise.resolve({
    nothing: 'burger',
  } as any));

  // THEN
  await expect(fetchNow()).rejects.toThrow(/Plugin returned a value that/);
});

test('error for an invalid initial value only describes the value by its keys', async () => {
  // GIVEN a value that fails the V3 guard (falsy accessKeyId)
  mockCredentialFunction(() => Promise.resolve({
    accessKeyId: '',
    secretAccessKey: 'sentinel-initial-a',
    sessionToken: 'sentinel-initial-b',
  } as any));

  // WHEN
  const error = await fetchNow().then(() => undefined, (e) => e);

  // THEN
  expect(error?.message).toMatch(/Plugin returned a value that/);
  expect(error?.message).toContain('accessKeyId');
  expect(error?.message).not.toContain('sentinel-initial-a');
  expect(error?.message).not.toContain('sentinel-initial-b');
});

test('error for a refresh type mismatch only describes the value by its keys', async () => {
  // GIVEN a plugin that first returns expiring V3 credentials, then V2-shaped credentials
  const mockProducer = jest.fn()
    .mockImplementationOnce(() => Promise.resolve({
      accessKeyId: 'initialkeyid',
      secretAccessKey: 'initialsecret',
      sessionToken: 'initialsession',
      expiration: new Date(Date.now() + 300_000), // 5 minutes from now
    } satisfies SDKv3CompatibleCredentials))
    .mockImplementationOnce(() => Promise.resolve({
      accessKeyId: 'sentinel-refresh-a',
      secretAccessKey: 'sentinel-refresh-b',
      sessionToken: 'sentinel-refresh-c',
      expired: false,
      getPromise: () => Promise.resolve({}),
    }));
  mockCredentialFunction(mockProducer);

  // WHEN
  await fetchNow();
  jest.advanceTimersByTime(300_000); // Make the credentials expire
  const error = await fetchNow().then(() => undefined, (e) => e);

  // THEN
  expect(error?.message).toMatch(/Plugin initially returned static V3/);
  expect(error?.message).toContain('getPromise');
  expect(error?.message).not.toContain('sentinel-refresh-a');
  expect(error?.message).not.toContain('sentinel-refresh-b');
  expect(error?.message).not.toContain('sentinel-refresh-c');
});

test('token expiration is allowed to be null', () => {
  expect(credentialsAboutToExpire({
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    // This is not allowed according to the `.d.ts` contract, but it can happen in reality
    expiration: null as any,
  })).toEqual(false);
});

function mockCredentialFunction(p: CredentialProviderSource['getProvider']) {
  mockCredentialPlugin({
    name: 'test',
    canProvideCredentials() {
      return Promise.resolve(true);
    },
    isAvailable() {
      return Promise.resolve(true);
    },
    getProvider(...args: Parameters<CredentialProviderSource['getProvider']>) {
      return p(...args);
    },
  });
}

function mockCredentialPlugin(p: CredentialProviderSource) {
  jest.mock(THE_PLUGIN, () => {
    return {
      version: '1',
      init(h: PluginHost) {
        h.registerCredentialProviderSource(p);
      },
    };
  }, { virtual: true });

  host._doLoad(THE_PLUGIN);
}

async function fetchNow() {
  const prov = await credentialPlugins.fetchCredentialsFor('1111', Mode.ForReading);
  return prov?.credentials();
}
