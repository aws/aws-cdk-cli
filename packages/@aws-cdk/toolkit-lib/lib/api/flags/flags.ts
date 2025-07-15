export interface FlagsOptions {
  /**
   * Change to default states
   *
   * @default true
   */
  readonly set: boolean;
  /**
   * Set the value of a flag
   */
  readonly value?: string;

  /**
   * Modify unconfigured flags
   *
   * @default true
   */
  readonly unconfigured: boolean;

  /**
   * Modify all flags
   *
   * @default true
   */
  readonly all: boolean;

  /**
   * Change to recommended states
   *
   * @default true
   */
  readonly recommended: boolean;

  /**
   * Change to default states
   *
   * @default true
   */
  readonly default: boolean;

}

