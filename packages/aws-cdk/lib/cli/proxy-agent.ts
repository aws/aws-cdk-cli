/* eslint-disable import/no-relative-packages */
import * as path from 'node:path';
import * as fs from 'fs-extra';
import { ProxyAgent, proxies } from 'proxy-agent';
// Imported from its defining module rather than the package barrel: this file is in the detached
// telemetry sender's import graph, and pulling in `@aws-cdk/toolkit-lib`'s entrypoint would drag the
// whole toolkit (~11MB) into that bundle for the sake of one error class.
import { ToolkitError } from '../../../@aws-cdk/toolkit-lib/lib/toolkit/toolkit-error';

/**
 * Validate a proxy address up front.
 *
 * `proxy-agent` only rejects an address with a missing or unsupported protocol
 * lazily, on the first request, so without `-vvv` the CLI appears to hang or
 * fails later with a misleading error (e.g. missing credentials). Fail fast
 * here with an actionable message instead.
 */
export function validateProxyAddress(proxyAddress: string): void {
  let protocol: string;
  try {
    protocol = new URL(proxyAddress).protocol.replace(/:$/, '');
  } catch {
    throw new ToolkitError(
      'InvalidProxyAddress',
      `Invalid proxy address '${proxyAddress}': it must be a URL that includes a protocol, e.g. 'http://${proxyAddress}'.`,
    );
  }

  if (!(protocol in proxies)) {
    throw new ToolkitError(
      'InvalidProxyAddress',
      `Unsupported protocol '${protocol}' in proxy address '${proxyAddress}'. Supported protocols are: ${Object.keys(proxies).join(', ')}.`,
    );
  }
}

/**
 * Options for proxy-agent SDKs
 */
interface ProxyAgentOptions {
  /**
   * Proxy address to use
   *
   * @default No proxy
   */
  readonly proxyAddress?: string;

  /**
   * A path to a certificate bundle that contains a cert to be trusted.
   *
   * @default No certificate bundle
   */
  readonly caBundlePath?: string;
}

/**
 * The proxy configuration resolved for this invocation.
 */
export interface ResolvedProxyAgent {
  /**
   * The agent to pass to anything making HTTPS requests in this process.
   */
  readonly agent: ProxyAgent;

  /**
   * Absolute path to the resolved CA bundle, if one was configured and exists on disk.
   *
   * Exposed because `agent` cannot cross a process boundary: the detached telemetry sender builds its
   * own and needs to be told which bundle to trust. The path travels rather than the bytes, because a
   * system bundle is routinely ~190KB.
   *
   * @default - no CA bundle was configured, or the configured one does not exist
   */
  readonly caBundlePath?: string;
}

/**
 * The part of `IoHelper` that proxy resolution needs.
 *
 * Structural so the detached telemetry sender, which has no IoHost, can pass a writer that goes to
 * stderr instead. A full `IoHelper` satisfies this as-is.
 */
export interface ProxyAgentDiagnostics {
  readonly defaults: {
    debug(message: string): Promise<void>;
  };
}

export class ProxyAgentProvider {
  private readonly ioHelper: ProxyAgentDiagnostics;

  public constructor(ioHelper: ProxyAgentDiagnostics) {
    this.ioHelper = ioHelper;
  }

  public async create(options: ProxyAgentOptions): Promise<ResolvedProxyAgent> {
    // Only validate when an actual proxy address was configured. When `--proxy`
    // is not given the setting is unset (and can surface at runtime as an empty
    // string or empty array), in which case we skip validation and let
    // ProxyAgent fall back to environment-variable detection.
    if (typeof options.proxyAddress === 'string' && options.proxyAddress.length > 0) {
      validateProxyAddress(options.proxyAddress);
    }

    // Force it to use the proxy provided through the command line.
    // Otherwise, let the ProxyAgent auto-detect the proxy using environment variables.
    const getProxyForUrl = options.proxyAddress != null
      ? () => Promise.resolve(options.proxyAddress!)
      : undefined;

    const caBundlePath = await this.resolveCABundlePath(options.caBundlePath);

    return {
      agent: new ProxyAgent({
        ca: await this.tryReadCABundle(caBundlePath),
        getProxyForUrl,
      }),
      caBundlePath,
    };
  }

  /**
   * Resolve the configured CA bundle to an absolute path, or undefined if there isn't a usable one.
   *
   * Absolute because the path is handed to the detached sender, which runs from a different cwd.
   */
  private async resolveCABundlePath(bundlePath?: string): Promise<string | undefined> {
    const configured = bundlePath || this.caBundlePathFromEnvironment();
    if (!configured) {
      return undefined;
    }

    try {
      const resolved = path.resolve(configured);
      await this.ioHelper.defaults.debug(`Using CA bundle path: ${resolved}`);
      return fs.pathExistsSync(resolved) ? resolved : undefined;
    } catch (e: any) {
      await this.ioHelper.defaults.debug(String(e));
      return undefined;
    }
  }

  private async tryReadCABundle(bundlePath?: string): Promise<string | undefined> {
    if (!bundlePath) {
      return undefined;
    }
    try {
      return fs.readFileSync(bundlePath, { encoding: 'utf-8' });
    } catch (e: any) {
      await this.ioHelper.defaults.debug(String(e));
      return undefined;
    }
  }

  /**
   * Find and return a CA certificate bundle path to be passed into the SDK.
   */
  private caBundlePathFromEnvironment(): string | undefined {
    if (process.env.aws_ca_bundle) {
      return process.env.aws_ca_bundle;
    }
    if (process.env.AWS_CA_BUNDLE) {
      return process.env.AWS_CA_BUNDLE;
    }
    return undefined;
  }
}
