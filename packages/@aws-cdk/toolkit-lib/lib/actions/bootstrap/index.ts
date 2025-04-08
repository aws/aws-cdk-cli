import type * as cxapi from '@aws-cdk/cx-api';
import { environmentsFromDescriptors } from './private';
import type { ICloudAssemblySource } from '../../api/cloud-assembly';
import { ALL_STACKS } from '../../api/cloud-assembly/private';
import type { IIoHost } from '../../api/io';
import type { Tag } from '../../api/shared-private';
import { asIoHelper } from '../../api/shared-private';
import { assemblyFromSource } from '../../toolkit/private';

/**
 * Create manage bootstrap environments
 */
export class BootstrapEnvironments {
  /**
   * Create from a list of environment descriptors
   * List of strings like `['aws://012345678912/us-east-1', 'aws://234567890123/eu-west-1']`
   */
  static fromList(environments: string[]): BootstrapEnvironments {
    return new BootstrapEnvironments(environmentsFromDescriptors(environments));
  }

  /**
   * Create from a cloud assembly source
   */
  static fromCloudAssemblySource(cx: ICloudAssemblySource): BootstrapEnvironments {
    return new BootstrapEnvironments(async (ioHost: IIoHost) => {
      const ioHelper = asIoHelper(ioHost, 'bootstrap');
      await using assembly = await assemblyFromSource(ioHelper, cx);
      const stackCollection = await assembly.selectStacksV2(ALL_STACKS);
      return stackCollection.stackArtifacts.map(stack => stack.environment);
    });
  }

  private constructor(private readonly envProvider: cxapi.Environment[] | ((ioHost: IIoHost) => Promise<cxapi.Environment[]>)) {

  }

  /**
   * Compute the bootstrap enviornments
   *
   * @internal
   */
  async getEnvironments(ioHost: IIoHost): Promise<cxapi.Environment[]> {
    if (Array.isArray(this.envProvider)) {
      return this.envProvider;
    }
    return this.envProvider(ioHost);
  }
}

/**
 * Options for Bootstrap
 */
export interface BootstrapOptions {

  /**
   * Bootstrap environment parameters for CloudFormation used when deploying the bootstrap stack
   * @default BootstrapEnvironmentParameters.onlyExisting()
   */
  readonly parameters?: BootstrapStackParameters;

  /**
   * The template source of the bootstrap stack
   *
   * @default BootstrapSource.default()
   */
  readonly source?: { source: 'default' } | { source: 'custom'; templateFile: string };

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
}

/**
 * Parameter values for the bootstrapping template
 */
export interface BootstrapParameters {
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

export interface EnvironmentBootstrapResult {
  environment: cxapi.Environment;
  status: 'success' | 'no-op';
  duration: number;
}

export interface BootstrapResult {
  environments: EnvironmentBootstrapResult[];
  duration: number;
}

/**
 * Parameters of the bootstrapping template with flexible configuration options
 */
export class BootstrapStackParameters {
  /**
   * Use only existing parameters on the stack.
   */
  public static onlyExisting() {
    return new BootstrapStackParameters({}, true);
  }

  /**
   * Use exactly these parameters and remove any other existing parameters from the stack.
   */
  public static exactly(params: BootstrapParameters) {
    return new BootstrapStackParameters(params, false);
  }

  /**
   * Define additional parameters for the stack, while keeping existing parameters for unspecified values.
   */
  public static withExisting(params: BootstrapParameters) {
    return new BootstrapStackParameters(params, true);
  }

  /**
   * The parameters as a Map for easy access and manipulation
   */
  public readonly parameters?: BootstrapParameters;
  public readonly keepExistingParameters: boolean;

  private constructor(params?: BootstrapParameters, usePreviousParameters = true) {
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
  static default(): BootstrapOptions['source'] {
    return { source: 'default' };
  }

  /**
   * Use a custom bootstrap template
   */
  static customTemplate(templateFile: string): BootstrapOptions['source'] {
    return {
      source: 'custom',
      templateFile,
    };
  }
}
