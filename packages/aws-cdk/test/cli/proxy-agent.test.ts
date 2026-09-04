import { ProxyAgentProvider, validateProxyAddress } from '../../lib/cli/proxy-agent';
import { TestIoHost } from '../_helpers/io-host';

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
