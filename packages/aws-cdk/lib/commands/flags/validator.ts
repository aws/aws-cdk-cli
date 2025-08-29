import type { FlagOperationsParams } from './types';
import type { IoHelper } from '../../api-private';

export class FlagValidator {
  constructor(private readonly ioHelper: IoHelper) {
  }

  /** Shows error message when CDK version is incompatible with flags command */
  async showIncompatibleVersionError(): Promise<void> {
    await this.ioHelper.defaults.error('The \'cdk flags\' command is not compatible with the AWS CDK library used by your application. Please upgrade to 2.212.0 or above.');
  }

  /** Validates all parameters and returns true if valid, false if any validation fails */
  async validateParams(params: FlagOperationsParams): Promise<boolean> {
    const validations = [
      () => this.validateFlagNameAndAll(params),
      () => this.validateSetRequirement(params),
      () => this.validateValueRequirement(params),
      () => this.validateMutuallyExclusive(params),
      () => this.validateUnconfiguredUsage(params),
      () => this.validateSetWithFlags(params),
    ];

    for (const validation of validations) {
      const isValid = await validation();
      if (!isValid) return false;
    }
    return true;
  }

  /** Validates that --all and specific flag names are not used together */
  private async validateFlagNameAndAll(params: FlagOperationsParams): Promise<boolean> {
    if (params.FLAGNAME && params.all) {
      await this.ioHelper.defaults.error('Error: Cannot use both --all and a specific flag name. Please use either --all to show all flags or specify a single flag name.');
      return false;
    }
    return true;
  }

  /** Validates that modification options require --set flag */
  private async validateSetRequirement(params: FlagOperationsParams): Promise<boolean> {
    if ((params.value || params.recommended || params.default || params.unconfigured) && !params.set) {
      await this.ioHelper.defaults.error('Error: This option can only be used with --set.');
      return false;
    }
    return true;
  }

  /** Validates that --value requires a specific flag name */
  private async validateValueRequirement(params: FlagOperationsParams): Promise<boolean> {
    if (params.value && !params.FLAGNAME) {
      await this.ioHelper.defaults.error('Error: --value requires a specific flag name. Please specify a flag name when providing a value.');
      return false;
    }
    return true;
  }

  /** Validates that mutually exclusive options are not used together */
  private async validateMutuallyExclusive(params: FlagOperationsParams): Promise<boolean> {
    if (params.recommended && params.default) {
      await this.ioHelper.defaults.error('Error: Cannot use both --recommended and --default. Please choose one option.');
      return false;
    }
    if (params.unconfigured && params.all) {
      await this.ioHelper.defaults.error('Error: Cannot use both --unconfigured and --all. Please choose one option.');
      return false;
    }
    return true;
  }

  /** Validates that --unconfigured is not used with specific flag names */
  private async validateUnconfiguredUsage(params: FlagOperationsParams): Promise<boolean> {
    if (params.unconfigured && params.FLAGNAME) {
      await this.ioHelper.defaults.error('Error: Cannot use --unconfigured with a specific flag name. --unconfigured works on multiple flags.');
      return false;
    }
    return true;
  }

  /** Validates that --set operations have required accompanying options */
  private async validateSetWithFlags(params: FlagOperationsParams): Promise<boolean> {
    if (params.set && params.FLAGNAME && !params.value) {
      await this.ioHelper.defaults.error('Error: When setting a specific flag, you must provide a --value.');
      return false;
    }
    if (params.set && params.all && !params.recommended && !params.default) {
      await this.ioHelper.defaults.error('Error: When using --set with --all, you must specify either --recommended or --default.');
      return false;
    }
    if (params.set && params.unconfigured && !params.recommended && !params.default) {
      await this.ioHelper.defaults.error('Error: When using --set with --unconfigured, you must specify either --recommended or --default.');
      return false;
    }
    return true;
  }
}
