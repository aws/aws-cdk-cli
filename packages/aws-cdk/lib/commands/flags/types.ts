import type { FlagsOptions } from '../../cli/user-input';

export enum FlagsMenuOptions {
  ALL_TO_RECOMMENDED = 'Set all flags to recommended values',
  UNCONFIGURED_TO_RECOMMENDED = 'Set unconfigured flags to recommended values',
  UNCONFIGURED_TO_DEFAULT = 'Set unconfigured flags to their implied configuration (record current behavior)',
  MODIFY_SPECIFIC_FLAG = 'Modify a specific flag',
  EXIT = 'Exit',
}

export interface FlagOperationsParams extends FlagsOptions {
  /** User provided --app option */
  app?: string;
}
