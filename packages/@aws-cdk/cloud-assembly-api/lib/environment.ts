import { CloudAssemblyError } from './private/error';

/**
 * Parser for the artifact environment field.
 *
 * Account validation is relaxed to allow account aliasing in the future.
 */
const AWS_ENV_REGEX = /aws\:\/\/([a-z0-9A-Z\-\@\.\_]+)\/([a-z\-0-9]+)/;

/**
 * Models an AWS execution environment, for use within the CDK toolkit.
 */
export interface Environment {
  /**
   * The display name of this environment, in the form `aws://<account>/<region>`
   *
   * This is always machine-generated, never user-set: it is either the
   * artifact's `environment` field (which has this shape) or formatted from
   * the account and region by `EnvironmentUtils.format`.
   *
   * Note that until the environment has been resolved, the account and region
   * may still be the `UNKNOWN_ACCOUNT`/`UNKNOWN_REGION` placeholders, so this
   * value is not necessarily usable as a `cdk` command line argument.
   */
  readonly name: string;

  /** The AWS account this environment deploys into */
  readonly account: string;

  /** The AWS region name where this environment deploys into */
  readonly region: string;
}

export const UNKNOWN_ACCOUNT = 'unknown-account';
export const UNKNOWN_REGION = 'unknown-region';

export class EnvironmentUtils {
  public static parse(environment: string): Environment {
    const env = AWS_ENV_REGEX.exec(environment);
    if (!env) {
      throw new CloudAssemblyError(
        `Unable to parse environment specification "${environment}". ` +
        'Expected format: aws://account/region');
    }

    const [, account, region] = env;
    if (!account || !region) {
      throw new CloudAssemblyError(`Invalid environment specification: ${environment}`);
    }

    return { account, region, name: environment };
  }

  /**
   * Build an environment object from an account and region
   */
  public static make(account: string, region: string): Environment {
    return { account, region, name: this.format(account, region) };
  }

  /**
   * Format an environment string from an account and region
   */
  public static format(account: string, region: string): string {
    return `aws://${account}/${region}`;
  }
}
