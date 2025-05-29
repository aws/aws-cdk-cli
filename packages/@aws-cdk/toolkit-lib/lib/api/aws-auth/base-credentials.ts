import type * as http from 'node:http';
import type * as https from 'node:https';
import type { SDKv3CompatibleCredentialProvider } from '@aws-cdk/cli-plugin-contract';
import { AwsCliCompatible } from './awscli-compatible';
import { AuthenticationError } from '../../toolkit/toolkit-error';
import type { IActionAwareIoHost } from '../io';
import { IoHostSdkLogger } from './sdk-logger';
import { IoHelper } from '../io/private';

/**
 * Settings for the request handle
 */
export interface RequestHandlerSettings {
  /**
   * The maximum time in milliseconds that the connection phase of a request
   * may take before the connection attempt is abandoned.
   *
   * Defaults to 0, which disables the timeout.
   */
  connectionTimeout?: number;
  /**
   * The number of milliseconds a request can take before automatically being terminated.
   * Defaults to 0, which disables the timeout.
   */
  requestTimeout?: number;
  /**
   * An http.Agent to be used
   */
  httpAgent?: http.Agent;
  /**
   * An https.Agent to be used
   */
  httpsAgent?: https.Agent;
}

/**
 * An SDK config that
 */
export interface SdkBaseConfig {
  /**
   * The credential provider to use for SDK calls.
   */
  readonly credentialProvider: SDKv3CompatibleCredentialProvider;
  /**
   * The default region to use for SDK calls.
   */
  readonly defaultRegion?: string;
}

export interface SdkBaseClientConfig {
  requestHandler?: RequestHandlerSettings;
}

export interface IBaseCredentialsProvider {
  sdkBaseConfig(ioHost: IActionAwareIoHost, clientConfig: SdkBaseClientConfig): Promise<SdkBaseConfig>;
}

export class BaseCredentials {
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
  public static none(): IBaseCredentialsProvider {
    return new class implements IBaseCredentialsProvider {
      public async sdkBaseConfig() {
        return {
          credentialProvider: () => {
            throw new AuthenticationError('No credentials available due to BaseCredentials.none()');
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
  public static awsCliCompatible(options: AwsCliCompatibleOptions = {}): IBaseCredentialsProvider {
    return new class implements IBaseCredentialsProvider {
      public sdkBaseConfig(ioHost: IActionAwareIoHost, clientConfig: SdkBaseClientConfig) {
        const ioHelper = IoHelper.fromActionAwareIoHost(ioHost);
        const awsCli = new AwsCliCompatible(ioHelper, clientConfig.requestHandler ?? {}, new IoHostSdkLogger(ioHelper));
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
  public static custom(options: CustomBaseCredentialsOption): IBaseCredentialsProvider {
    return new class implements IBaseCredentialsProvider {
      public sdkBaseConfig(): Promise<SdkBaseConfig> {
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
