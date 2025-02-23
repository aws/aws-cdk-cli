import { Tag } from '../../api/aws-cdk';

/**
 * Options for Bootstrap
 */
export interface BootstrapOptions {

  /**
   * Bootstrap environment parameters for CloudFormation used when deploying the bootstrap stack
   * @default BootstrapEnvironmentParameters.onlyExisting()
   */
  readonly parameters?: BootstrapEnvironmentParameters;

  /**
   * The template source of the bootstrap stack
   *
   * @default BootstrapSource.default()
   */
  readonly source?: BootstrapSource;

  /**
   * Whether to execute the changeset or only create it and leave it in review
   * @default true
   */
  readonly execute?: boolean;

  /**
   * Tags for cdktoolkit stack
   *
   * @default []
   */
  readonly tags?: Tag[];

  /**
   * Whether the stacks created by the bootstrap process should be protected from termination
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-protect-stacks.html
   * @default true
   */
  readonly terminationProtection?: boolean;

  /**
   * Use previous values for unspecified parameters
   *
   * If not set, all parameters must be specified for every deployment
   *
   * @default true
   */
  usePreviousParameters?: boolean;
}

/**
 * Parameter values for the bootstrapping template
 */
export interface BootstrapParameterValues {
  /**
   * The name to be given to the CDK Bootstrap bucket
   * By default, a name is generated by CloudFormation
   *
   * @default - No value, optional argument
   */
  readonly bucketName?: string;

  /**
   * The ID of an existing KMS key to be used for encrypting items in the bucket
   * By default, the default KMS key is used
   *
   * @default - No value, optional argument
   */
  readonly kmsKeyId?: string;

  /**
   * Whether or not to create a new customer master key (CMK)
   *
   * Only applies to modern bootstrapping
   * Legacy bootstrapping will never create a CMK, only use the default S3 key
   *
   * @default false
   */
  readonly createCustomerMasterKey?: boolean;

  /**
   * The list of AWS account IDs that are trusted to deploy into the environment being bootstrapped
   *
   * @default []
   */
  readonly trustedAccounts?: string[];

  /**
   * The list of AWS account IDs that are trusted to look up values in the environment being bootstrapped
   *
   * @default []
   */
  readonly trustedAccountsForLookup?: string[];

  /**
   * The list of AWS account IDs that should not be trusted by the bootstrapped environment
   * If these accounts are already trusted, they will be removed on bootstrapping
   *
   * @default []
   */
  readonly untrustedAccounts?: string[];

  /**
   * The ARNs of the IAM managed policies that should be attached to the role performing CloudFormation deployments
   * In most cases, this will be the AdministratorAccess policy
   * At least one policy is required if `trustedAccounts` were passed
   *
   * @default []
   */
  readonly cloudFormationExecutionPolicies?: string[];

  /**
   * Identifier to distinguish multiple bootstrapped environments
   * The default qualifier is an arbitrary but unique string
   *
   * @default - 'hnb659fds'
   */
  readonly qualifier?: string;

  /**
   * Whether or not to enable S3 Staging Bucket Public Access Block Configuration
   *
   * @default true
   */
  readonly publicAccessBlockConfiguration?: boolean;

  /**
   * Flag for using the default permissions boundary for bootstrapping
   *
   * @default - No value, optional argument
   */
  readonly examplePermissionsBoundary?: boolean;

  /**
   * Name for the customer's custom permissions boundary for bootstrapping
   *
   * @default - No value, optional argument
   */
  readonly customPermissionsBoundary?: string;
}

/**
 * Parameters for the bootstrapping template with flexible configuration options
 */
export class BootstrapEnvironmentParameters {
  /**
   * Use only existing parameters on the stack.
   */
  public static onlyExisting() {
    return new BootstrapEnvironmentParameters({}, true);
  }

  /**
   * Use exactly these parameters and remove any other existing parameters from the stack.
   */
  public static exactly(params: BootstrapParameterValues) {
    return new BootstrapEnvironmentParameters(params, false);
  }

  /**
   * Define additional parameters for the stack, while keeping existing parameters for unspecified values.
   */
  public static withExisting(params: BootstrapParameterValues) {
    return new BootstrapEnvironmentParameters(params, true);
  }

  /**
   * The parameters as a Map for easy access and manipulation
   */
  public readonly parameters?: BootstrapParameterValues;
  public readonly keepExistingParameters: boolean;

  private constructor(params?: BootstrapParameterValues, usePreviousParameters = true) {
    this.keepExistingParameters = usePreviousParameters;
    this.parameters = params;
  }
}

/**
 * Source configuration for bootstrap operations
 */
export class BootstrapSource {
  /**
   * Use the default bootstrap template
   */
  static default(): BootstrapSource {
    return new BootstrapSource('default');
  }

  /**
   * Use a custom bootstrap template
   */
  static customTemplate(templateFile: string): BootstrapSource {
    return new BootstrapSource('custom', templateFile);
  }

  private readonly source: 'default' | 'custom';
  private readonly templateFile?: string;
  private constructor(source: 'default' | 'custom', templateFile?: string) {
    this.source = source;
    this.templateFile = templateFile;
  }

  public render() {
    return {
      source: this.source,
      ...(this.templateFile ? { templateFile: this.templateFile } : {}),
    } as { source: 'default' } | { source: 'custom'; templateFile: string };
  }
}
