import type { CredentialProviderSource, SDKv2CompatibleCredentials, SDKv3CompatibleCredentials } from '@aws-cdk/cli-plugin-contract';
import { CredentialPlugins, credentialsAboutToExpire } from '../../../lib/api/aws-auth/private';
import { Mode, PluginHost } from '../../../lib/api/plugin';
import { ToolkitError } from '../../../lib/toolkit/toolkit-error';
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
  const secrets = sentinelSecrets('refresh-type-mismatch');
  const mockProducer = jest.fn()
    .mockImplementationOnce(() => Promise.resolve({
      accessKeyId: 'keyid',
      secretAccessKey: 'secret',
      sessionToken: 'session',
      expiration: new Date(Date.now() + 300_000), // 5 minutes from now
    } satisfies SDKv3CompatibleCredentials))
    // Refresh returns a secret-carrying V2-compatible object, not a function: a function has
    // nothing to leak, so it would let the rejected value be printed without any test noticing.
    .mockImplementationOnce(() => Promise.resolve({
      accessKeyId: secrets.accessKeyId,
      secretAccessKey: secrets.secretAccessKey,
      sessionToken: secrets.sessionToken,
      expireTime: new Date(Date.now() + 600_000),
      getPromise: () => Promise.resolve(),
    } satisfies SDKv2CompatibleCredentials));
  mockCredentialFunction(mockProducer);

  // WHEN
  await fetchNow();
  jest.advanceTimersByTime(300_000); // Make the credentials expire
  const error = await fetchNow().then(() => undefined, (e) => e);

  // THEN
  expect(ToolkitError.isAuthenticationError(error)).toBe(true);
  expect(error.name).toBe('PluginCredentialTypeMismatch');
  expect(error.message).toMatch(/Plugin initially returned static V3/);
  expect(error.message).toContain("credential provider source 'test'");
  expect(error.message).toContain('when refreshing expired credentials');
  expectNoSecrets(error, [secrets.accessKeyId, secrets.secretAccessKey, secrets.sessionToken]);
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

test('plugin returning a flat object with a falsy accessKeyId does not leak the rejected value', async () => {
  // GIVEN
  // `isV3Credentials` demands a *truthy* accessKeyId and there is no `getPromise`, so this object
  // satisfies none of the guards and reaches the "doesn't resemble AWS credentials" error while
  // still carrying a real secret.
  const secrets = sentinelSecrets('flat-empty-access-key-id');
  mockCredentialFunction(() => Promise.resolve({
    accessKeyId: '',
    secretAccessKey: secrets.secretAccessKey,
    sessionToken: secrets.sessionToken,
  } as any));

  // WHEN
  const error = await fetchNow().then(() => undefined, (e) => e);

  // THEN
  expect(ToolkitError.isAuthenticationError(error)).toBe(true);
  expect(error.name).toBe('InvalidPluginCredentials');
  expect(error.message).toMatch(/Plugin returned a value that/);
  expect(error.message).toContain("credential provider source 'test'");
  expect(error.message).toContain('during initial credential resolution');
  expectNoSecrets(error, [secrets.secretAccessKey, secrets.sessionToken]);
});

test('plugin returning secrets nested under a "credentials" key, with no top-level accessKeyId, does not leak them', async () => {
  // GIVEN
  // Keep the secrets nested. Hoisting `accessKeyId` to the top level would turn this into valid V3
  // credentials, the error path would no longer be reached, and this test would silently stop
  // guarding anything.
  const secrets = sentinelSecrets('nested-credentials-object');
  mockCredentialFunction(() => Promise.resolve({
    region: 'us-east-1',
    credentials: {
      accessKeyId: secrets.accessKeyId,
      secretAccessKey: secrets.secretAccessKey,
      sessionToken: secrets.sessionToken,
    },
  } as any));

  // WHEN
  const error = await fetchNow().then(() => undefined, (e) => e);

  // THEN
  expect(ToolkitError.isAuthenticationError(error)).toBe(true);
  expect(error.name).toBe('InvalidPluginCredentials');
  expect(error.message).toMatch(/Plugin returned a value that/);
  expect(error.message).toContain("credential provider source 'test'");
  expectNoSecrets(error, [secrets.accessKeyId, secrets.secretAccessKey, secrets.sessionToken]);
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

/**
 * Synthetic secret values that must never show up in an error message.
 *
 * Deliberately not shaped like real AWS credentials, so a leak of these into a log can never be
 * confused for an actual credential.
 */
function sentinelSecrets(label: string) {
  return {
    accessKeyId: `sentinel-access-key-id-${label}`,
    secretAccessKey: `sentinel-secret-access-key-${label}`,
    sessionToken: `sentinel-session-token-${label}`,
  };
}

function expectNoSecrets(error: any, secrets: string[]) {
  const rendered = [error?.message, error?.stack, String(error)].join('\n');
  for (const secret of secrets) {
    expect(rendered).not.toContain(secret);
  }
}
