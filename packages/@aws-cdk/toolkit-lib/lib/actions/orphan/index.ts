export interface OrphanOptions {
  /**
   * Construct path prefix(es) to orphan. Each path must be in the format
   * `StackName/ConstructPath`, e.g. `MyStack/MyTable`.
   *
   * The stack is derived from the path — all paths must reference the same stack.
   */
  readonly constructPaths: string[];

  /**
   * Role to assume in the target environment.
   */
  readonly roleArn?: string;

  /**
   * Toolkit stack name for bootstrap resources.
   */
  readonly toolkitStackName?: string;
}
