/**
 * Options for the drift command
 */
export interface DriftCommandOptions {
  /**
   * Stack names to check for drift
   */
  readonly stackNames: string[];

  /**
   * Only select the given stack
   *
   * @default false
   */
  readonly exclusively?: boolean;

  /**
   * Run in quiet mode without printing status messages
   *
   * @default false
   */
  readonly quiet?: boolean;

  /**
   * Whether to fail with exit code 1 if drift is detected
   *
   * @default false
   */
  readonly fail?: boolean;
}
