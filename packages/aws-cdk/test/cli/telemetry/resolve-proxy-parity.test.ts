/**
 * Differential parity test: our built-ins-only proxy resolution vs. the real thing.
 *
 * The CLI itself resolves proxies with `proxy-agent`, which delegates to `proxy-from-env` whenever
 * the user did not pass `--proxy`. The detached telemetry sender cannot use `proxy-agent` (it has
 * no dependencies available), so `resolveProxy` re-implements that logic. This test pins the
 * re-implementation to the original by running both over the same table of environments.
 *
 * Note that we deliberately resolve `proxy-from-env` *through* `proxy-agent` rather than importing
 * it directly. A bare import picks up the hoisted copy, which is a different major version with
 * different `NO_PROXY` semantics -- comparing against that would make this test worse than
 * useless. `proxy-agent` is a real dependency of this package, and this reaches the exact copy it
 * uses.
 */
import { resolveProxy } from '../../../lib/cli/telemetry/sender';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realGetProxyForUrl: (url: string) => string = require(
  require.resolve('proxy-from-env', { paths: [require.resolve('proxy-agent')] }),
).getProxyForUrl;

const TELEMETRY_URL = 'https://cdk-cli-telemetry.us-east-1.api.aws/metrics';

const CASES: Array<[name: string, url: string, env: Record<string, string>]> = [
  ['HTTPS_PROXY set', TELEMETRY_URL, { HTTPS_PROXY: 'http://corp:8080' }],
  ['lowercase https_proxy', TELEMETRY_URL, { https_proxy: 'http://corp:8080' }],
  ['only HTTP_PROXY set (must not apply to https)', TELEMETRY_URL, { HTTP_PROXY: 'http://corp:8080' }],
  ['ALL_PROXY', TELEMETRY_URL, { ALL_PROXY: 'http://corp:8080' }],
  ['lowercase all_proxy', TELEMETRY_URL, { all_proxy: 'http://corp:8080' }],
  ['no proxy variables at all', TELEMETRY_URL, {}],
  ['NO_PROXY exact host', TELEMETRY_URL, { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: 'cdk-cli-telemetry.us-east-1.api.aws' }],
  ['NO_PROXY domain suffix', TELEMETRY_URL, { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: '.api.aws' }],
  ['NO_PROXY suffix without dot', TELEMETRY_URL, { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: 'api.aws' }],
  ['NO_PROXY wildcard', TELEMETRY_URL, { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: '*' }],
  ['NO_PROXY non-matching', TELEMETRY_URL, { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: 'example.com' }],
  ['NO_PROXY comma+space list', TELEMETRY_URL, { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: 'foo.com, .api.aws ,bar.com' }],
  ['NO_PROXY host:port match', TELEMETRY_URL, { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: 'cdk-cli-telemetry.us-east-1.api.aws:443' }],
  ['NO_PROXY host:port mismatch', TELEMETRY_URL, { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: 'cdk-cli-telemetry.us-east-1.api.aws:8443' }],
  ['NO_PROXY empty entries', TELEMETRY_URL, { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: ',,  ,' }],
  ['scheme-less proxy value', TELEMETRY_URL, { HTTPS_PROXY: 'corp:8080' }],
  ['npm_config_https_proxy fallback', TELEMETRY_URL, { npm_config_https_proxy: 'http://corp:8080' }],
  ['npm_config_proxy fallback', TELEMETRY_URL, { npm_config_proxy: 'http://corp:8080' }],
  ['socks proxy passes through unchanged', TELEMETRY_URL, { HTTPS_PROXY: 'socks5://corp:1080' }],
  ['pac proxy passes through unchanged', TELEMETRY_URL, { HTTPS_PROXY: 'pac+http://corp/proxy.pac' }],
  ['authenticated proxy url', TELEMETRY_URL, { HTTPS_PROXY: 'http://user:pass@corp:8080' }],
  ['explicit non-default port + NO_PROXY host', 'https://localhost:8443/metrics', { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: 'localhost' }],
  ['explicit non-default port + NO_PROXY host:port', 'https://localhost:8443/metrics', { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: 'localhost:8443' }],
  ['explicit non-default port + wrong NO_PROXY port', 'https://localhost:8443/metrics', { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: 'localhost:9999' }],
  ['http endpoint uses HTTP_PROXY', 'http://example.com/x', { HTTP_PROXY: 'http://corp:8080' }],
  ['http endpoint ignores HTTPS_PROXY', 'http://example.com/x', { HTTPS_PROXY: 'http://corp:8080' }],
  ['uppercase NO_PROXY beats nothing', TELEMETRY_URL, { HTTPS_PROXY: 'http://corp:8080', no_proxy: '.api.aws' }],
  ['IPv6 endpoint', 'https://[::1]:8443/x', { HTTPS_PROXY: 'http://corp:8080' }],
];

describe('resolveProxy parity with proxy-from-env', () => {
  const savedEnv = process.env;

  afterEach(() => {
    process.env = savedEnv;
  });

  test.each(CASES)('%s', (_name, url, env) => {
    // proxy-from-env reads process.env directly, so swap it for the duration of the call.
    process.env = { ...env } as NodeJS.ProcessEnv;
    let expected: string;
    try {
      expected = realGetProxyForUrl(url);
    } finally {
      process.env = savedEnv;
    }

    expect(resolveProxy(url, env)).toEqual(expected);
  });

  test('the reference implementation is the version proxy-agent actually uses', () => {
    const resolved = require.resolve('proxy-from-env', { paths: [require.resolve('proxy-agent')] });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const version = require(`${resolved.slice(0, resolved.lastIndexOf('/'))}/package.json`).version;

    // v2 changed NO_PROXY matching; if this ever bumps, the parity table above must be revisited.
    expect(version).toMatch(/^1\./);
  });
});
