// This is a legacy wrapper for code from the aws-auth that we want to keep the signatures intact
// We generally use two different patterns here:
// - make a copy of the old code as is
// - wrap the old code and add a deprecation warning
// - make a no-op copy that preserves the previous interface but doesn't do anything
// This way we can keep the old code running until the new code is fully ready
// and can be used by the users that are ready to migrate
// The old code will be removed in a future version of aws-cdk
import type { AwsCredentialIdentityProvider, Logger, NodeHttpHandlerOptions } from '@smithy/types';
import { SdkProvider as SdkProviderCurrentVersion } from './api/aws-auth';
import { CliIoHost } from './cli/io-host';

/**
 * @deprecated
 */
export function cached<A extends object, B>(obj: A, sym: symbol, fn: () => B): B {
  if (!(sym in obj)) {
    (obj as any)[sym] = fn();
  }
  return (obj as any)[sym];
}

/**
 * @deprecated
 */
export interface ContextProviderPlugin {
  getValue(args: {[key: string]: any}): Promise<any>;
}

/**
 * An AWS account
 * @deprecated
 */
export interface Account {
  readonly accountId: string;
  readonly partition: string;
}

/**
 * Enable tracing in the CDK
 *
 * @deprecated cannot be enabled from outside the CDK
 */
export function enableTracing(_enabled: boolean) {
  // noop
}

/**
 * Options for individual SDKs
 * @deprecated
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
 * @deprecated
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

/**
 * @deprecated
 */
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
