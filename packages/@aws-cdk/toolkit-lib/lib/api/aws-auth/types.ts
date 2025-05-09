import type { SDKv3CompatibleCredentialProvider } from '@aws-cdk/cli-plugin-contract';
import type { SdkProviderServices } from '../shared-private';
import { AwsCliCompatible } from '../shared-private';

/**
 * Options for the default SDK provider
 */
export interface SdkConfig {
  /**
   * The base credentials and region used to seed the Toolkit with
   *
   * @default BaseCredentials.awsCliCompatible()
   */
  readonly baseCredentials?: BaseCredentials;

  /**
   * Profile to read from ~/.aws for base credentials
   *
   * @default - No profile
   * @deprecated Use `baseCredentials` instead
   */
  readonly profile?: string;

  /**
   * HTTP options for SDK
   */
  readonly httpOptions?: SdkHttpOptions;
}

/**
 * Options for individual SDKs
 */
export interface SdkHttpOptions {
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

export abstract class BaseCredentials {
  /**
   * Use no base credentials
   *
   * There will be no current account and no current region during synthesis. To
   * successfully deploy with this set of base credentials:
   *
   * - The CDK app must provide concrete accounts and regions during synthesis
   * - Credential plugins must be installed to provide credentials for those
   *   accounts.
   */
  public static none(): BaseCredentials {
    return new class extends BaseCredentials {
      public async makeSdkConfig(): Promise<SdkBaseConfig> {
        return {
          credentialProvider: () => {
            // eslint-disable-next-line @cdklabs/no-throw-default-error
            throw new Error('No credentials available due to BaseCredentials.none()');
          },
        };
      }

      public toString() {
        return 'BaseCredentials.none()';
      }
    };
  }

  /**
   * Obtain base credentials and base region the same way the AWS CLI would
   *
   * Credentials and region will be read from the environment first, falling back
   * to INI files or other sources if available.
   *
   * The profile name is configurable.
   */
  public static awsCliCompatible(options: AwsCliCompatibleOptions = {}): BaseCredentials {
    return new class extends BaseCredentials {
      public makeSdkConfig(services: SdkProviderServices): Promise<SdkBaseConfig> {
        const awsCli = new AwsCliCompatible(services.ioHelper, services.requestHandler ?? {}, services.logger);
        return awsCli.baseConfig(options.profile);
      }

      public toString() {
        return `BaseCredentials.awsCliCompatible(${JSON.stringify(options)})`;
      }
    };
  }

  /**
   * Use a custom SDK identity provider for the base credentials
   *
   * If your provider uses STS calls to obtain base credentials, you must make
   * sure to also configure the necessary HTTP options (like proxy and user
   * agent) and the region on the STS client directly; the toolkit code cannot
   * do this for you.
   */
  public static custom(options: CustomBaseCredentialsOption): BaseCredentials {
    return new class extends BaseCredentials {
      public makeSdkConfig(): Promise<SdkBaseConfig> {
        return Promise.resolve({
          credentialProvider: options.provider,
          defaultRegion: options.region,
        });
      }

      public toString() {
        return `BaseCredentials.custom(${JSON.stringify({
          ...options,
          provider: '...',
        })})`;
      }
    };
  }

  /**
   * Make SDK config from the BaseCredentials settings
   */
  public abstract makeSdkConfig(services: SdkProviderServices): Promise<SdkBaseConfig>;
}

export interface AwsCliCompatibleOptions {
  /**
   * The profile to read from `~/.aws/credentials`.
   *
   * If not supplied the environment variable AWS_PROFILE will be used.
   *
   * @default - Use environment variable if set.
   */
  readonly profile?: string;
}

export interface CustomBaseCredentialsOption {
  /**
   * The credentials provider to use to obtain base credentials
   *
   * If your provider uses STS calls to obtain base credentials, you must make
   * sure to also configure the necessary HTTP options (like proxy and user
   * agent) on the STS client directly; the toolkit code cannot do this for you.
   */
  readonly provider: SDKv3CompatibleCredentialProvider;

  /**
   * The default region to synthesize for
   *
   * CDK applications can override this region. NOTE: this region will *not*
   * affect any STS calls made by the given provider, if any. You need to configure
   * your credential provider separately.
   *
   * @default 'us-east-1'
   */
  readonly region?: string;
}

export interface SdkBaseConfig {
  readonly credentialProvider: SDKv3CompatibleCredentialProvider;

  readonly defaultRegion?: string;
}
