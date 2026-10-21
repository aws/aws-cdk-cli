import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'fs-extra';
import { normalizeNetworkSetting, ProxyAgentProvider, validateProxyAddress } from '../../lib/cli/proxy-agent';
import { expectIoMsg, TestIoHost } from '../_helpers/io-host';

describe('validateProxyAddress', () => {
  test.each([
    'http://localhost:1234',
    'https://proxy.example.com:8080',
    'socks5://localhost:1080',
    'pac+http://localhost/proxy.pac',
  ])('accepts a proxy address with a supported protocol: %s', (address) => {
    expect(() => validateProxyAddress(address)).not.toThrow();
  });

  test.each([
    'localhost:1234',
    '1.2.3.4:8080',
    'proxy.example.com',
  ])('rejects a proxy address without a usable protocol: %s', (address) => {
    expect(() => validateProxyAddress(address)).toThrow(/proxy address/i);
  });

  test('rejects a proxy address with an unsupported protocol', () => {
    expect(() => validateProxyAddress('ftp://localhost:1234')).toThrow(/Unsupported protocol/i);
  });
});

describe('ProxyAgentProvider', () => {
  const ioHost = new TestIoHost();

  test('create() fails fast with a clear error when the proxy address has no protocol', async () => {
    const provider = new ProxyAgentProvider(ioHost.asHelper('deploy'));
    await expect(provider.create({ proxyAddress: 'localhost:1234' })).rejects.toThrow(/proxy address/i);
  });

  test('create() succeeds with a valid proxy address', async () => {
    const provider = new ProxyAgentProvider(ioHost.asHelper('deploy'));
    await expect(provider.create({ proxyAddress: 'http://localhost:1234' })).resolves.toBeDefined();
  });

  test.each([
    ['undefined', undefined],
    ['an empty string', ''],
    // Settings.get() can surface an unset value as an empty array at runtime.
    ['an empty array', [] as unknown as string],
  ])('create() does not validate when the proxy address is %s (no --proxy given)', async (_desc, proxyAddress) => {
    const provider = new ProxyAgentProvider(ioHost.asHelper('deploy'));
    await expect(provider.create({ proxyAddress })).resolves.toBeDefined();
  });
});

describe('CA bundle resolution', () => {
  const ENV_VARS = [
    'aws_ca_bundle', 'AWS_CA_BUNDLE', 'REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE',
    'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_PROFILE', 'AWS_DEFAULT_PROFILE',
  ];
  let savedEnv: Record<string, string | undefined>;
  let tmpDir: string;
  let ioHost: TestIoHost;
  const bundles: Record<string, string> = {};

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_VARS.map((name) => [name, process.env[name]]));
    ENV_VARS.forEach((name) => delete process.env[name]);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-ca-bundle-'));
    for (const name of ['explicit', 'aws-env', 'default-profile', 'named-profile', 'credentials-file', 'requests-env']) {
      bundles[name] = path.join(tmpDir, `${name}.pem`);
      fs.writeFileSync(bundles[name], `-----BEGIN CERTIFICATE-----\n${name}\n-----END CERTIFICATE-----\n`);
    }

    const configFile = path.join(tmpDir, 'config');
    fs.writeFileSync(configFile, [
      '[default]',
      `ca_bundle = ${bundles['default-profile']}`,
      '',
      '[profile named]',
      `ca_bundle = ${bundles['named-profile']}`,
      '',
      '[profile no-bundle]',
      'region = us-east-1',
      '',
    ].join('\n'));
    process.env.AWS_CONFIG_FILE = configFile;
    // Keep the developer's own ~/.aws/credentials out of the picture; a test that needs one writes it.
    process.env.AWS_SHARED_CREDENTIALS_FILE = path.join(tmpDir, 'no-credentials');

    ioHost = new TestIoHost('debug');
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    fs.removeSync(tmpDir);
  });

  async function resolveBundle(options: { caBundlePath?: string; profile?: string } = {}) {
    const { caBundlePath } = await new ProxyAgentProvider(ioHost.asHelper('deploy')).create(options);
    return caBundlePath;
  }

  test('an explicit caBundlePath wins over everything else', async () => {
    process.env.AWS_CA_BUNDLE = bundles['aws-env'];
    process.env.REQUESTS_CA_BUNDLE = bundles['requests-env'];

    await expect(resolveBundle({ caBundlePath: bundles.explicit, profile: 'named' })).resolves.toBe(bundles.explicit);
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expectIoMsg(expect.stringContaining('from --ca-bundle-path'), 'debug'));
  });

  test('AWS_CA_BUNDLE wins over the profile ca_bundle and REQUESTS_CA_BUNDLE', async () => {
    process.env.AWS_CA_BUNDLE = bundles['aws-env'];
    process.env.REQUESTS_CA_BUNDLE = bundles['requests-env'];

    await expect(resolveBundle({ profile: 'named' })).resolves.toBe(bundles['aws-env']);
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expectIoMsg(`Using CA bundle path from AWS_CA_BUNDLE: ${bundles['aws-env']}`, 'debug'));
  });

  test('the ca_bundle of the profile passed in wins over REQUESTS_CA_BUNDLE', async () => {
    process.env.REQUESTS_CA_BUNDLE = bundles['requests-env'];

    await expect(resolveBundle({ profile: 'named' })).resolves.toBe(bundles['named-profile']);
    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expectIoMsg(`Using CA bundle path from ca_bundle of profile 'named': ${bundles['named-profile']}`, 'debug'),
    );
  });

  test('a ca_bundle in the credentials file wins over the one in the config file, like botocore', async () => {
    const credentialsFile = path.join(tmpDir, 'credentials');
    fs.writeFileSync(credentialsFile, ['[named]', `ca_bundle = ${bundles['credentials-file']}`, ''].join('\n'));
    process.env.AWS_SHARED_CREDENTIALS_FILE = credentialsFile;

    await expect(resolveBundle({ profile: 'named' })).resolves.toBe(bundles['credentials-file']);
  });

  test('the profile falls back to AWS_PROFILE', async () => {
    process.env.AWS_PROFILE = 'named';

    await expect(resolveBundle()).resolves.toBe(bundles['named-profile']);
  });

  test('the profile falls back to AWS_DEFAULT_PROFILE', async () => {
    process.env.AWS_DEFAULT_PROFILE = 'named';

    await expect(resolveBundle()).resolves.toBe(bundles['named-profile']);
  });

  test('the profile falls back to the default profile', async () => {
    await expect(resolveBundle()).resolves.toBe(bundles['default-profile']);
  });

  test('REQUESTS_CA_BUNDLE is used when the profile has no ca_bundle', async () => {
    process.env.REQUESTS_CA_BUNDLE = bundles['requests-env'];

    await expect(resolveBundle({ profile: 'no-bundle' })).resolves.toBe(bundles['requests-env']);
    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expectIoMsg(`Using CA bundle path from REQUESTS_CA_BUNDLE: ${bundles['requests-env']}`, 'debug'),
    );
  });

  test('REQUESTS_CA_BUNDLE is used when there is no config file', async () => {
    process.env.AWS_CONFIG_FILE = path.join(tmpDir, 'does-not-exist');
    process.env.REQUESTS_CA_BUNDLE = bundles['requests-env'];

    await expect(resolveBundle()).resolves.toBe(bundles['requests-env']);
  });

  test('no CA bundle when nothing is configured', async () => {
    process.env.AWS_CONFIG_FILE = path.join(tmpDir, 'does-not-exist');

    await expect(resolveBundle()).resolves.toBeUndefined();
  });

  test('SSL_CERT_FILE is not consulted, matching the AWS CLI', async () => {
    process.env.SSL_CERT_FILE = bundles['requests-env'];
    process.env.AWS_CONFIG_FILE = path.join(tmpDir, 'does-not-exist');

    await expect(resolveBundle()).resolves.toBeUndefined();
  });
});

describe('normalizeNetworkSetting', () => {
  test('keeps an empty string, which means "go direct" and is NOT the same as unconfigured', () => {
    // The whole point of normalizing: a truthiness check here would turn an explicit `--proxy ''`
    // into environment auto-detection, so the CLI and the detached sender would disagree about
    // whether a proxy applies.
    expect(normalizeNetworkSetting('')).toBe('');
  });

  test('keeps a configured value unchanged', () => {
    expect(normalizeNetworkSetting('http://localhost:1234')).toBe('http://localhost:1234');
    expect(normalizeNetworkSetting('/etc/ssl/certs/ca.pem')).toBe('/etc/ssl/certs/ca.pem');
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    // Settings.get() is untyped and surfaces an unset value as an empty array at runtime.
    ['an empty array', []],
    ['a populated array', ['http://a', 'http://b']],
    ['a number', 8080],
    ['an object', { proxy: 'http://localhost:1234' }],
  ])('treats %s as unconfigured', (_desc, raw) => {
    expect(normalizeNetworkSetting(raw)).toBeUndefined();
  });

  test('an empty array would otherwise survive a truthiness check and break path.resolve', () => {
    // Why this has to happen at the boundary rather than downstream: [] is truthy, so it slips past
    // `if (value)` and only fails inside path.resolve, whose TypeError the CA-bundle resolver
    // swallows -- silently discarding the bundle.
    const raw: unknown = [];

    expect(Boolean(raw)).toBe(true);
    expect(() => path.resolve(raw as string)).toThrow(/must be of type string/);
    expect(normalizeNetworkSetting(raw)).toBeUndefined();
  });
});
