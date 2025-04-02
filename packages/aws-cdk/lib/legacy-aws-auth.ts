// This is a legacy wrapper for code from the aws-auth that we want to keep the signatures intact
// We generally use two different patterns here:
// - make a copy of the old code as is
// - wrap the old code and add a deprecation warning
// This way we can keep the old code running until the new code is fully ready
// and can be used by the users that are ready to migrate
// The old code will be removed in a future version of aws-cdk
import type { AwsCredentialIdentityProvider, Logger, NodeHttpHandlerOptions } from '@smithy/types';
import { SdkProvider as SdkProviderCurrentVersion } from './api/aws-auth/sdk-provider';
import { CliIoHost } from './cli/io-host';

/**
 * Options for individual SDKs
 */
interface SdkHttpOptions {
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
 * Options for the default SDK provider
 */
interface SdkProviderOptions {
  /**
   * Profile to read from ~/.aws
   *
   * @default - No profile
   */
  readonly profile?: string;

  /**
   * HTTP options for SDK
   */
  readonly httpOptions?: SdkHttpOptions;

  /**
   * The logger for sdk calls.
   */
  readonly logger?: Logger;
}

export class SdkProvider {
  public static async withAwsCliCompatibleDefaults(options: SdkProviderOptions = {}) {
    return SdkProviderCurrentVersion.withAwsCliCompatibleDefaults({
      ...options,
      ioHelper: CliIoHost.instance().asIoHelper(),
    });
  }

  public constructor(
    defaultCredentialProvider: AwsCredentialIdentityProvider,
    defaultRegion: string,
    requestHandler: NodeHttpHandlerOptions = {},
    logger?: Logger,
  ) {
    return new SdkProviderCurrentVersion(defaultCredentialProvider, defaultRegion, requestHandler, CliIoHost.instance().asIoHelper(), logger);
  }
}
