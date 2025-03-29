import { ProxyAgent } from 'proxy-agent';
import type { SdkHttpOptions } from './sdk-provider';
import { readIfPossible } from './util';
import { IO, type IoHelper } from '../../../../@aws-cdk/tmp-toolkit-helpers/src/api/io/private';

export class ProxyAgentProvider {
  private readonly ioHelper: IoHelper;

  public constructor(ioHelper: IoHelper) {
    this.ioHelper = ioHelper;
  }

  public async create(options: SdkHttpOptions) {
    // Force it to use the proxy provided through the command line.
    // Otherwise, let the ProxyAgent auto-detect the proxy using environment variables.
    const getProxyForUrl = options.proxyAddress != null
      ? () => Promise.resolve(options.proxyAddress!)
      : undefined;

    return new ProxyAgent({
      ca: await this.tryGetCACert(options.caBundlePath),
      getProxyForUrl,
    });
  }

  private async tryGetCACert(bundlePath?: string) {
    const path = bundlePath || this.caBundlePathFromEnvironment();
    if (path) {
      await this.ioHelper.notify(IO.DEFAULT_SDK_DEBUG.msg(`Using CA bundle path: ${path}`));
      return readIfPossible(path);
    }
    return undefined;
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

