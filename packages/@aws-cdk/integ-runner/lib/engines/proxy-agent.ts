import * as fs from 'fs-extra';
import { ProxyAgent } from 'proxy-agent';

/**
 * Options for creating a proxy agent
 */
export interface ProxyAgentOptions {
  /**
   * Proxy address to use
   *
   * @default - ProxyAgent auto-detects from environment variables
   */
  readonly proxyAddress?: string;

  /**
   * A path to a certificate bundle that contains a cert to be trusted.
   *
   * @default - reads from AWS_CA_BUNDLE environment variable
   */
  readonly caBundlePath?: string;
}

/**
 * Cached provider for proxy-aware HTTP agents.
 *
 * Reuses the same ProxyAgent instance for identical configurations
 * to avoid creating multiple agents across engine instances.
 */
export class ProxyAgentProvider {
  /**
   * Get or create a ProxyAgent for the given options.
   * Returns a cached instance if one already exists for the same configuration.
   */
  public static getOrCreate(options: ProxyAgentOptions = {}): ProxyAgent {
    const key = JSON.stringify([options.proxyAddress, options.caBundlePath]);

    const cached = ProxyAgentProvider.cache.get(key);
    if (cached) {
      return cached;
    }

    const getProxyForUrl = options.proxyAddress != null
      ? () => Promise.resolve(options.proxyAddress!)
      : undefined;

    const agent = new ProxyAgent({
      ca: tryReadCaBundle(options.caBundlePath),
      getProxyForUrl,
    });

    ProxyAgentProvider.cache.set(key, agent);
    return agent;
  }

  /**
   * Clear the cache. Intended for testing only.
   */
  public static clearCache(): void {
    ProxyAgentProvider.cache.clear();
  }

  private static readonly cache = new Map<string, ProxyAgent>();
}

/**
 * Try to read a CA bundle from the given path, or from the AWS_CA_BUNDLE environment variable.
 */
function tryReadCaBundle(bundlePath?: string): string | undefined {
  const resolvedPath = bundlePath ?? process.env.AWS_CA_BUNDLE ?? process.env.aws_ca_bundle;
  if (!resolvedPath) {
    return undefined;
  }
  try {
    return fs.readFileSync(resolvedPath, 'utf-8');
  } catch {
    return undefined;
  }
}
