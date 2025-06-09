import type * as https from 'node:https';
import type { IBaseCredentialsProvider } from './base-credentials';

/**
 * Options for the default SDK provider
 */
export interface SdkConfig {
  /**
   * The base credentials and region used to seed the Toolkit with
   *
   * @default BaseCredentials.awsCliCompatible()
   */
  readonly baseCredentials?: IBaseCredentialsProvider;

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
   * The agent responsible for making the network requests.
   *
   * Use this so set up a proxy connection.
   *
   * @default - Uses the shared global node agent
   */
  readonly agent?: https.Agent;
}
